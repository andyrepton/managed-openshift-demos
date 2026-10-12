import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import type { PriceTable, Sku } from '@aro-planner/common';
import { createRouter } from '../src/router';

const PRICES: PriceTable = {
  currency: 'USD',
  region: 'westeurope',
  vm: {
    Standard_D8s_v5: 0.46,
    Standard_D16s_v5: 0.92,
    Standard_D16as_v5: 0.832,
    Standard_D8s_v3: 0.464,
    Standard_E16s_v5: 1.208,
    Standard_E32s_v5: 2.416,
  },
  aroLicence: {
    'Azure Red Hat OpenShift General Purpose|8': 0.342,
    'Azure Red Hat OpenShift General Purpose|16': 0.684,
    'Azure Red Hat OpenShift Memory Optimized|16': 0.684,
    'Azure Red Hat OpenShift Memory Optimized|32': 1.368,
  },
  aroLicencePerVcpu: 0.0428,
  retrievedAt: '2026-10-12T00:00:00.000Z',
};

function app(opts: Parameters<typeof createRouter>[0] = {}) {
  const a = express();
  a.use('/api/aro-planner', createRouter({ buildPrices: async () => PRICES, ...opts }));
  return a;
}

describe('GET /health', () => {
  it('reports ok', async () => {
    const res = await request(app()).get('/api/aro-planner/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('GET /skus', () => {
  it('returns the worker catalogue by default', async () => {
    const res = await request(app()).get('/api/aro-planner/skus');
    expect(res.status).toBe(200);
    expect(res.body.skus.length).toBeGreaterThan(100);
    expect(res.body.skus.every((s: Sku) => s.role === 'worker')).toBe(true);
  });

  it('excludes day-2-only sizes unless asked', async () => {
    const off = await request(app()).get('/api/aro-planner/skus');
    const on = await request(app()).get('/api/aro-planner/skus?dayTwo=true');
    expect(off.body.skus.every((s: Sku) => !s.day2Only)).toBe(true);
    expect(on.body.skus.length).toBeGreaterThan(off.body.skus.length);
  });

  it('rejects an unknown profile', async () => {
    const res = await request(app()).get('/api/aro-planner/skus?profile=nonsense');
    expect(res.status).toBe(400);
  });
});

describe('POST /plan', () => {
  it('returns ranked recommendations and a costed estimate', async () => {
    const res = await request(app())
      .post('/api/aro-planner/plan')
      .send({ vcpu: 40, ramGiB: 160, region: 'westeurope', flavour: 'hcp' });

    expect(res.status).toBe(200);
    expect(res.body.recommendations.length).toBeGreaterThan(0);
    expect(res.body.estimate.hourly).toBeGreaterThan(0);
    expect(res.body.estimate.monthly).toBeCloseTo(res.body.estimate.hourly * 730, 1);
  });

  it('costs the first recommendation, which is the cheapest', async () => {
    const res = await request(app())
      .post('/api/aro-planner/plan')
      .send({ vcpu: 40, ramGiB: 160, region: 'westeurope' });

    const costs = res.body.recommendations.map((r: { hourlyVmCost: number }) => r.hourlyVmCost);
    expect(costs).toEqual([...costs].sort((a: number, b: number) => a - b));

    const top = res.body.recommendations[0];
    const vmLine = res.body.estimate.lines.find((l: { label: string }) =>
      l.label.startsWith('Worker VMs'),
    );
    expect(vmLine.label).toContain(top.sku.name);
  });

  it('infers the profile from the RAM:vCPU ratio when not given', async () => {
    const res = await request(app())
      .post('/api/aro-planner/plan')
      .send({ vcpu: 16, ramGiB: 256, region: 'westeurope' });
    expect(res.body.request.profile).toBe('memory-heavy');
  });

  it('bills control plane VMs for classic but not for HCP', async () => {
    const classic = await request(app())
      .post('/api/aro-planner/plan')
      .send({ vcpu: 40, ramGiB: 160, flavour: 'classic', controlPlaneSku: 'Standard_D8s_v3' });
    const hcp = await request(app())
      .post('/api/aro-planner/plan')
      .send({ vcpu: 40, ramGiB: 160, flavour: 'hcp' });

    const has = (b: { estimate: { lines: { label: string }[] } }) =>
      b.estimate.lines.some(l => l.label.startsWith('Control plane VMs'));
    expect(has(classic.body)).toBe(true);
    expect(has(hcp.body)).toBe(false);
  });

  it('excludes the unpublished HCP fee by default', async () => {
    const res = await request(app())
      .post('/api/aro-planner/plan')
      .send({ vcpu: 40, ramGiB: 160, flavour: 'hcp' });
    const fee = res.body.estimate.lines.find((l: { label: string }) =>
      l.label === 'Hosted control plane fee',
    );
    expect(fee.included).toBe(false);
    expect(fee.source).toBe('assumption');
  });

  it('includes the HCP fee when configured, marked as an override', async () => {
    const res = await request(app({ overrides: { hcpControlPlanePerHour: 0.25 } }))
      .post('/api/aro-planner/plan')
      .send({ vcpu: 40, ramGiB: 160, flavour: 'hcp' });
    const fee = res.body.estimate.lines.find((l: { label: string }) =>
      l.label === 'Hosted control plane fee',
    );
    expect(fee.included).toBe(true);
    expect(fee.source).toBe('override');
  });
});

describe('POST /plan - input validation', () => {
  const cases: [string, Record<string, unknown>][] = [
    ['missing vcpu', { ramGiB: 160 }],
    ['zero vcpu', { vcpu: 0, ramGiB: 160 }],
    ['negative ram', { vcpu: 8, ramGiB: -1 }],
    ['implausible vcpu', { vcpu: 999999, ramGiB: 160 }],
    ['bad flavour', { vcpu: 8, ramGiB: 32, flavour: 'onprem' }],
    ['bad profile', { vcpu: 8, ramGiB: 32, profile: 'nonsense' }],
    ['injection-shaped region', { vcpu: 8, ramGiB: 32, region: "x' or '1'='1" }],
    ['unsupported control plane sku', { vcpu: 8, ramGiB: 32, flavour: 'classic', controlPlaneSku: 'Standard_NOPE' }],
  ];

  for (const [name, body] of cases) {
    it(`rejects ${name}`, async () => {
      const res = await request(app()).post('/api/aro-planner/plan').send(body);
      expect(res.status).toBe(400);
      expect(res.body.error).toBeTruthy();
    });
  }
});

describe('POST /plan - price fetch failures', () => {
  it('returns 502 when Azure is unreachable and nothing is cached', async () => {
    const res = await request(
      app({ buildPrices: async () => { throw new Error('ENOTFOUND prices.azure.com'); } }),
    )
      .post('/api/aro-planner/plan')
      .send({ vcpu: 40, ramGiB: 160 });

    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/Azure Retail Prices API/);
  });

  it('serves stale prices and flags them when a refresh fails', async () => {
    let calls = 0;
    const buildPrices = vi.fn(async () => {
      if (++calls === 1) return PRICES;
      throw new Error('ENOTFOUND prices.azure.com');
    });
    // ttlMs 0 forces a refresh attempt on the second call.
    const a = app({ buildPrices: buildPrices as never, ttlMs: 0 });

    const first = await request(a).post('/api/aro-planner/plan').send({ vcpu: 40, ramGiB: 160 });
    expect(first.body.pricesStale).toBe(false);

    const second = await request(a).post('/api/aro-planner/plan').send({ vcpu: 40, ramGiB: 160 });
    expect(second.status).toBe(200);
    expect(second.body.pricesStale).toBe(true);
    expect(second.body.estimate.assumptions.join(' ')).toMatch(/cached snapshot/);
  });

  it('caches per region so repeated requests do not re-query Azure', async () => {
    const buildPrices = vi.fn(async () => PRICES);
    const a = app({ buildPrices: buildPrices as never });

    for (let i = 0; i < 3; i++) {
      await request(a).post('/api/aro-planner/plan').send({ vcpu: 40, ramGiB: 160, region: 'westeurope' });
    }
    expect(buildPrices).toHaveBeenCalledTimes(1);
  });
});

describe('POST /plan - malformed endpoints', () => {
  // Each of these previously threw inside the async handler: no response sent,
  // client left waiting for its own timeout.
  const bad: [string, unknown][] = [
    ['missing target', [{ name: 'x', direction: 'egress' }]],
    ['unknown target kind', [{ name: 'x', direction: 'egress', target: { kind: 'carrier-pigeon' } }]],
    ['namespace target with no namespace', [{ name: 'x', direction: 'egress', target: { kind: 'namespace' } }]],
    ['bad direction', [{ name: 'x', direction: 'sideways', target: { kind: 'internet' } }]],
    ['endpoints not an array', { name: 'x' }],
    ['port out of range', [{ name: 'x', direction: 'egress', target: { kind: 'internet' }, ports: [{ protocol: 'TCP', port: 99999 }] }]],
  ];

  for (const [name, endpoints] of bad) {
    it(`returns 400 for ${name} rather than hanging`, async () => {
      const res = await request(app())
        .post('/api/aro-planner/plan')
        .send({ vcpu: 40, ramGiB: 160, endpoints });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid endpoints');
    });
  }

  it('accepts on-premises with no cidrs, defaulting to empty', async () => {
    const res = await request(app())
      .post('/api/aro-planner/plan')
      .send({ vcpu: 40, ramGiB: 160, endpoints: [{ name: 'db', direction: 'egress', target: { kind: 'on-premises' } }] });
    expect(res.status).toBe(200);
  });

  it('generates policies for valid endpoints', async () => {
    const res = await request(app())
      .post('/api/aro-planner/plan')
      .send({
        applicationName: 'payments',
        vcpu: 40, ramGiB: 160,
        endpoints: [{ name: 'web', direction: 'ingress', target: { kind: 'internet' } }],
      });
    expect(res.status).toBe(200);
    expect(res.body.networkPlan.namespace).toBe('payments');
    expect(res.body.networkPlan.policies.length).toBeGreaterThan(4);
  });
});
