import { describe, expect, it } from 'vitest';

import { CONTROL_PLANE_NODES, MissingPriceError, estimateCost } from '../src/cost.js';
import { getSku } from '../src/skus.js';
import type { ClusterPlan, NodePoolPlan } from '../src/types.js';
import { WESTEUROPE_PRICES } from './fixtures.js';

function pool(skuName: string, nodes: number): NodePoolPlan {
  const sku = getSku(skuName, 'worker');
  if (!sku) throw new Error(`fixture error: unknown SKU ${skuName}`);
  return {
    sku,
    nodes,
    totalVcpu: sku.vcpu * nodes,
    totalRamGiB: sku.ramGiB * nodes,
    allocatableVcpu: (sku.vcpu - 1) * nodes,
    allocatableRamGiB: (sku.ramGiB - 4) * nodes,
    waste: 0,
    rationale: [],
  };
}

describe('estimateCost - classic ARO', () => {
  const plan: ClusterPlan = {
    flavour: 'classic',
    region: 'westeurope',
    controlPlaneSku: getSku('Standard_D8s_v5', 'control-plane'),
    workerPools: [pool('Standard_D8s_v5', 6)],
  };

  const estimate = estimateCost(plan, WESTEUROPE_PRICES);

  // Cross-checked against a live Azure Retail Prices API query on 2026-10-12:
  //   worker VMs  6 x $0.46   = $2.7600/hr
  //   control pl. 3 x $0.46   = $1.3800/hr
  //   licence     6 x $0.342  = $2.0520/hr
  //   total                     $6.1920/hr
  it('matches the figures published by the Retail Prices API', () => {
    expect(estimate.hourly).toBe(6.192);
    expect(estimate.monthly).toBe(4520.16);
  });

  it('charges the control plane as infrastructure but never licenses it', () => {
    const cp = estimate.lines.find(l => l.label.startsWith('Control plane VMs'));
    // 1.38, not the 1.3800000000000001 that 0.46 * 3 produces in binary floating
    // point - every line is rounded so the displayed parts sum to the displayed total.
    expect(cp?.hourly).toBe(1.38);
    expect(CONTROL_PLANE_NODES).toBe(3);

    // Exactly one licence line, and it is the worker pool's.
    const licences = estimate.lines.filter(l => l.label.startsWith('ARO licence'));
    expect(licences).toHaveLength(1);
    expect(licences[0]?.detail).toBe('48 worker vCPU');
  });

  it('prefers the published meter over the flat per-vCPU rate', () => {
    const licence = estimate.lines.find(l => l.label.startsWith('ARO licence'));
    // 6 x $0.342 = $2.052, not 48 x $0.0428 = $2.0544. Microsoft rounds the meters.
    expect(licence?.hourly).toBe(2.052);
    expect(licence?.source).toBe('azure-api');
    expect(licence?.sourceNote).toContain('8 vCPU');
  });

  it('falls back to the per-vCPU rate when no meter is published', () => {
    // No "...General Purpose|48" meter exists in the fixture.
    const big: ClusterPlan = { ...plan, workerPools: [pool('Standard_D48s_v5', 3)] };
    const licence = estimateCost(big, {
      ...WESTEUROPE_PRICES,
      vm: { ...WESTEUROPE_PRICES.vm, Standard_D48s_v5: 2.76 },
    }).lines.find(l => l.label.startsWith('ARO licence'));

    expect(licence?.hourly).toBe(0.0428 * 48 * 3);
    expect(licence?.sourceNote).toContain('flat');
  });
});

describe('estimateCost - ARO HCP', () => {
  const plan: ClusterPlan = {
    flavour: 'hcp',
    region: 'westeurope',
    workerPools: [pool('Standard_D8s_v5', 3)],
  };

  it('excludes the unpublished control-plane fee rather than pricing it at zero', () => {
    const estimate = estimateCost(plan, WESTEUROPE_PRICES);
    const cp = estimate.lines.find(l => l.label === 'Hosted control plane fee');

    expect(cp?.included).toBe(false);
    expect(cp?.source).toBe('assumption');
    expect(estimate.assumptions.join(' ')).toContain('has not published');

    // Workers + licence only: 3 x $0.46 + 3 x $0.342
    expect(estimate.hourly).toBe(2.406);
  });

  it('surfaces the provenance note verbatim so the reader knows where the figure came from', () => {
    const note = 'Borrowed from the ROSA HCP cluster fee as a demo stand-in.';
    const estimate = estimateCost(plan, WESTEUROPE_PRICES, {
      hcpControlPlanePerHour: 0.25,
      hcpControlPlaneNote: note,
    });
    const fee = estimate.lines.find(l => l.label === 'Hosted control plane fee');
    expect(fee?.sourceNote).toContain(note);
    expect(fee?.sourceNote).toMatch(/^ASSUMPTION:/);
    expect(estimate.assumptions.join(' ')).toContain(note);
    // Never dressed up as a real Azure price.
    expect(fee?.source).not.toBe('azure-api');
  });

  it('includes the fee when one is configured, and flags it as not from Azure', () => {
    const estimate = estimateCost(plan, WESTEUROPE_PRICES, { hcpControlPlanePerHour: 0.25 });
    const cp = estimate.lines.find(l => l.label === 'Hosted control plane fee');

    expect(cp?.included).toBe(true);
    expect(cp?.source).toBe('override');
    expect(estimate.hourly).toBe(2.656);
    expect(estimate.assumptions.join(' ')).toContain('ASSUMPTION, NOT A CONFIRMED PRICE');
    expect(estimate.assumptions.join(' ')).toContain('has not published a rate for ARO HCP');
  });

  it('bills no control plane VMs at all', () => {
    const estimate = estimateCost(plan, WESTEUROPE_PRICES);
    expect(estimate.lines.some(l => l.label.startsWith('Control plane VMs'))).toBe(false);
  });
});

describe('estimateCost - safety', () => {
  it('throws rather than guessing when a SKU has no price in the region', () => {
    const plan: ClusterPlan = {
      flavour: 'hcp',
      region: 'westeurope',
      workerPools: [pool('Standard_L8s_v3', 3)],
    };
    expect(() => estimateCost(plan, WESTEUROPE_PRICES)).toThrow(MissingPriceError);
  });

  it('never silently includes an excluded line in the total', () => {
    const plan: ClusterPlan = {
      flavour: 'hcp',
      region: 'westeurope',
      workerPools: [pool('Standard_D8s_v5', 3)],
    };
    const estimate = estimateCost(plan, WESTEUROPE_PRICES);
    const included = estimate.lines.filter(l => l.included).reduce((s, l) => s + l.hourly, 0);
    expect(estimate.hourly).toBeCloseTo(included, 6);
  });

  it('surfaces a stale price snapshot as an assumption', () => {
    const plan: ClusterPlan = {
      flavour: 'hcp',
      region: 'westeurope',
      workerPools: [pool('Standard_D8s_v5', 3)],
    };
    const estimate = estimateCost(plan, { ...WESTEUROPE_PRICES, stale: true });
    expect(estimate.assumptions.join(' ')).toContain('cached snapshot');
  });
});
