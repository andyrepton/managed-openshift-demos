import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { OPERATOR_CATALOG } from '@aro-planner/common';

import { OperatorHubClient, type JsonResponse } from '../src/operatorHub';
import { createRouter } from '../src/router';
import { WESTEUROPE_PRICES } from './fixtures';

/** A PackageManifest list carrying whichever package names are asked for. */
function listOf(names: string[]): JsonResponse {
  return {
    status: 200,
    body: {
      items: names.map(name => ({
        metadata: { name },
        status: {
          catalogSource: 'redhat-operators',
          defaultChannel: 'stable',
          channels: [
            { name: 'alpha', currentCSVDesc: { version: '0.0.1' } },
            { name: 'stable', currentCSVDesc: { version: '1.2.3' } },
          ],
        },
      })),
    },
  };
}

function client(overrides: Partial<ConstructorParameters<typeof OperatorHubClient>[0]> = {}) {
  return new OperatorHubClient({
    baseUrl: 'https://api.test',
    readToken: async () => 'token',
    requestJson: async () => listOf(OPERATOR_CATALOG.map(o => o.packageName)),
    ...overrides,
  });
}

describe('OperatorHubClient', () => {
  it('reports every approved operator as available when the catalog has them', async () => {
    const statuses = await client().statuses();
    expect(statuses).toHaveLength(OPERATOR_CATALOG.length);
    expect(statuses.every(s => s.availability === 'available')).toBe(true);
  });

  it('takes the version from the default channel, not the first one', async () => {
    const [first] = await client().statuses();
    expect(first!.version).toBe('1.2.3');
  });

  it('marks a package the catalog does not have as missing, not unknown', async () => {
    const statuses = await client({
      requestJson: async () => listOf([OPERATOR_CATALOG[0]!.packageName]),
    }).statuses();
    expect(statuses[0]!.availability).toBe('available');
    expect(statuses.slice(1).every(s => s.availability === 'missing')).toBe(true);
  });

  it('separates "not permitted" from "not there", because they mean different things', async () => {
    const statuses = await client({
      requestJson: async () => ({ status: 403, body: undefined }),
    }).statuses();
    expect(statuses.every(s => s.availability === 'unknown')).toBe(true);
    expect(statuses[0]!.reason).toMatch(/may not list packagemanifests/);
  });

  it('reports unknown with no token, which is the normal case off-cluster', async () => {
    const statuses = await client({
      readToken: async () => {
        throw new Error('ENOENT');
      },
    }).statuses();
    expect(statuses.every(s => s.availability === 'unknown')).toBe(true);
    expect(statuses[0]!.reason).toMatch(/no ServiceAccount token/);
  });

  it('survives an unreachable API server rather than failing the request', async () => {
    const statuses = await client({
      requestJson: async () => {
        throw new Error('ECONNREFUSED');
      },
    }).statuses();
    expect(statuses.every(s => s.availability === 'unknown')).toBe(true);
    expect(statuses[0]!.reason).toMatch(/ECONNREFUSED/);
  });

  it('caches, so a form that re-queries on every keystroke hits the API once', async () => {
    const requestJson = vi.fn(async () => listOf(OPERATOR_CATALOG.map(o => o.packageName)));
    const c = client({ requestJson });
    await c.statuses();
    await c.statuses();
    await c.statuses();
    expect(requestJson).toHaveBeenCalledTimes(1);
  });
});

describe('GET /operators', () => {
  function app(hub = client()) {
    const a = express();
    a.use(
      '/api/aro-planner',
      createRouter({ buildPrices: async () => WESTEUROPE_PRICES, operatorHub: hub }),
    );
    return a;
  }

  it('returns the curated footprint alongside the live status', async () => {
    const res = await request(app()).get('/api/aro-planner/operators');
    expect(res.status).toBe(200);
    expect(res.body.operators).toHaveLength(OPERATOR_CATALOG.length);

    const rhbk = res.body.operators.find((o: { id: string }) => o.id === 'rhbk');
    expect(rhbk.vcpu).toBe(OPERATOR_CATALOG.find(o => o.id === 'rhbk')!.vcpu);
    expect(rhbk.status.availability).toBe('available');
    expect(rhbk.sourceNote).toBeTruthy();
  });

  it('still answers when the cluster cannot be reached', async () => {
    const res = await request(
      app(
        client({
          requestJson: async () => {
            throw new Error('no route to host');
          },
        }),
      ),
    ).get('/api/aro-planner/operators');
    expect(res.status).toBe(200);
    expect(res.body.operators[0].status.availability).toBe('unknown');
  });
});

describe('POST /plan with operators', () => {
  function app() {
    const a = express();
    a.use(
      '/api/aro-planner',
      createRouter({ buildPrices: async () => WESTEUROPE_PRICES, operatorHub: client() }),
    );
    return a;
  }

  const base = { vcpu: 40, ramGiB: 160, region: 'westeurope', flavour: 'hcp' };

  it('sizes for more capacity once an operator is selected', async () => {
    const without = await request(app()).post('/api/aro-planner/plan').send(base);
    const with_ = await request(app())
      .post('/api/aro-planner/plan')
      .send({ ...base, operators: ['amq-streams'] });

    expect(without.status).toBe(200);
    expect(with_.status).toBe(200);
    expect(with_.body.recommendations[0].allocatableVcpu).toBeGreaterThanOrEqual(
      without.body.recommendations[0].allocatableVcpu,
    );
  });

  it('echoes the request back with the operators it honoured', async () => {
    const res = await request(app())
      .post('/api/aro-planner/plan')
      .send({ ...base, operators: ['rhbk', 'rhbk'] });
    expect(res.status).toBe(200);
    expect(res.body.request.operators).toEqual(['rhbk']);
  });

  it('rejects an unknown operator rather than silently dropping it', async () => {
    const res = await request(app())
      .post('/api/aro-planner/plan')
      .send({ ...base, operators: ['rhbk', 'not-a-thing'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unknown operator/);
  });

  it('rejects a non-array', async () => {
    const res = await request(app())
      .post('/api/aro-planner/plan')
      .send({ ...base, operators: 'rhbk' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/must be an array/);
  });
});
