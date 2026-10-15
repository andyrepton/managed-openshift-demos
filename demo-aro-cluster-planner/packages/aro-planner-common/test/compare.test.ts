import { describe, expect, it } from 'vitest';

import { DEMO_MULTIPLIERS, cheapestPriced, compareModels } from '../src/compare.js';
import { estimateCost } from '../src/cost.js';
import { getSku } from '../src/skus.js';
import type { ClusterPlan, NodePoolPlan, SizingRequest } from '../src/types.js';
import { WESTEUROPE_PRICES } from './fixtures.js';

function pool(name: string, nodes: number): NodePoolPlan {
  const sku = getSku(name, 'worker')!;
  return {
    sku, nodes,
    totalVcpu: sku.vcpu * nodes, totalRamGiB: sku.ramGiB * nodes,
    allocatableVcpu: (sku.vcpu - 1) * nodes, allocatableRamGiB: (sku.ramGiB - 4) * nodes,
    waste: 0, rationale: [],
  };
}

const req: SizingRequest = {
  flavour: 'hcp', region: 'westeurope', vcpu: 40, ramGiB: 160,
  profile: 'general', highAvailability: true, dayTwo: false,
};

const p = pool('Standard_D16s_v5', 3);
const plan: ClusterPlan = { flavour: 'hcp', region: 'westeurope', workerPools: [p] };
const dedicated = { plan, pool: p };
const opts = { prices: WESTEUROPE_PRICES, dedicated };
const baseMonthly = estimateCost(plan, WESTEUROPE_PRICES).monthly;

describe('which models appear', () => {
  it('always costs all three, whatever is selected', () => {
    // The UI shows a price against every option so the alternatives are visible
    // before switching. Costing only the selection left the others blank.
    for (const sel of ['shared-namespace', 'dedicated-cluster', 'on-premises'] as const) {
      expect(compareModels({ ...req, deploymentModel: sel }, opts).map(x => x.model)).toEqual([
        'shared-namespace',
        'dedicated-cluster',
        'on-premises',
      ]);
    }
  });

  it('gives every model a price', () => {
    for (const c of compareModels(req, opts)) expect(c.amount).toBeGreaterThan(0);
  });
});

describe('demo multipliers', () => {
  it('prices a shared namespace at half the dedicated ALLOCATABLE per-vCPU rate', () => {
    // Both sides must be allocatable. Dividing by raw pool vCPU while multiplying
    // by allocatable requested vCPU made the "50%" multiplier land at 41.7%.
    const shared = compareModels(req, opts).find(x => x.model === 'shared-namespace')!;
    const perVcpu = baseMonthly / p.allocatableVcpu;
    expect(shared.amount).toBeCloseTo(perVcpu * req.vcpu * DEMO_MULTIPLIERS.sharedNamespace, 0);
  });

  it('a request that exactly fills the cluster lands on the stated multiplier', () => {
    // The clearest statement of the unit fix: ask for exactly the allocatable
    // capacity and the ratio is the multiplier, not 83% of it.
    const full = { ...req, vcpu: p.allocatableVcpu };
    const c = compareModels(full, opts);
    const shared = c.find(x => x.model === 'shared-namespace')!.amount!;
    const dedicated = c.find(x => x.model === 'dedicated-cluster')!.amount!;
    expect(shared / dedicated).toBeCloseTo(DEMO_MULTIPLIERS.sharedNamespace, 2);
  });

  it('moves the namespace price on every vCPU change, not only when the pool changes', () => {
    // A dedicated cluster's price plateaus - 30 and 44 vCPU buy the same three
    // nodes. A namespace is a slice of requested capacity, so it must not inherit
    // that plateau or the figure looks frozen while the user is adjusting it.
    const prices = [30, 36, 40, 44].map(
      v => compareModels({ ...req, vcpu: v }, opts).find(x => x.model === 'shared-namespace')!.amount!,
    );
    expect(new Set(prices).size).toBe(prices.length);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
  });

  it('prices on-premises at five times the per-vCPU rate, monthly', () => {
    const onPrem = compareModels(req, opts).find(x => x.model === 'on-premises')!;
    const perVcpu = baseMonthly / p.allocatableVcpu;
    expect(onPrem.amount).toBeCloseTo(perVcpu * req.vcpu * DEMO_MULTIPLIERS.onPremises, 0);
    expect(onPrem.billing).toBe('monthly');
  });

  it('bills every model monthly', () => {
    for (const c of compareModels(req, opts)) expect(c.billing).toBe('monthly');
  });

  it('scales with the size of the request', () => {
    const big = compareModels({ ...req, vcpu: 80 }, opts);
    const small = compareModels(req, opts);
    expect(big.find(x => x.model === 'shared-namespace')!.amount!).toBeGreaterThan(
      small.find(x => x.model === 'shared-namespace')!.amount!,
    );
  });
});

describe('the made-up numbers are labelled as made up', () => {
  it('never tags a derived figure as an Azure price', () => {
    for (const c of compareModels(req, opts)) {
      if (c.model === 'dedicated-cluster') continue;
      expect(c.estimate!.lines.every(l => l.source !== 'azure-api')).toBe(true);
      expect(c.estimate!.lines.every(l => l.source === 'assumption')).toBe(true);
    }
  });

  it('says plainly that the figure is invented', () => {
    const shared = compareModels(req, opts).find(x => x.model === 'shared-namespace')!;
    const text = shared.estimate!.assumptions.join(' ');
    expect(text).toContain('ASSUMPTION FOR THE DEMO, NOT A REAL PRICE');
    expect(text).toContain('not a benchmark');
  });

  it('is explicit that the on-premises monthly figure is amortised, not a bill', () => {
    const onPrem = compareModels(req, opts).find(x => x.model === 'on-premises')!;
    expect(onPrem.summary).toContain('not a bill');
    expect(onPrem.estimate!.assumptions.join(' ')).toContain('NOT A REAL PRICE');
  });

  it('keeps the dedicated cluster priced from Azure', () => {
    const d = compareModels(req, opts).find(x => x.model === 'dedicated-cluster')!;
    expect(d.estimate!.lines.some(l => l.source === 'azure-api')).toBe(true);
  });
});

describe('cheapestPriced', () => {
  it('picks the lower of two monthly figures', () => {
    expect(cheapestPriced(compareModels(req, opts))?.model).toBe('shared-namespace');
  });

  it('picks the cheapest across all three when they are compared together', () => {
    expect(cheapestPriced(compareModels(req, opts))?.model).toBe('shared-namespace');
  });

  it('declares no winner from a single option', () => {
    expect(cheapestPriced(compareModels(req, opts).slice(0, 1))).toBeNull();
  });
});

describe('configured rates override the demo multipliers', () => {
  const overrides = {
    sharedClusterPerVcpuHour: 0.02,
    sharedClusterNote: 'Internal chargeback rate agreed with finance.',
    onPremPerVcpuHour: 0.015,
    onPremNote: 'From the 2026 DC refresh business case.',
  };

  it('uses the configured rate instead of the multiplier', () => {
    const c = compareModels(req, { ...opts, overrides });
    const shared = c.find(x => x.model === 'shared-namespace')!;
    expect(shared.estimate!.hourly).toBeCloseTo(0.02 * req.vcpu, 4);
  });

  it('marks a configured rate as an override, not an assumption or an Azure price', () => {
    const c = compareModels(req, { ...opts, overrides });
    const onPrem = c.find(x => x.model === 'on-premises')!;
    expect(onPrem.estimate!.lines[0]!.source).toBe('override');
    expect(onPrem.estimate!.lines[0]!.sourceNote).toContain('2026 DC refresh business case');
  });

  it('falls back to the demo multiplier when no rate is configured', () => {
    const shared = compareModels(req, opts).find(x => x.model === 'shared-namespace')!;
    expect(shared.estimate!.lines[0]!.source).toBe('assumption');
  });
});

describe('on-premises and storage', () => {
  // The form tells the user on-prem storage is costed separately. That has to be
  // true of the number as well: on-prem was derived from the dedicated estimate,
  // which includes an Azure managed disk priced per provisioned tier, so the
  // figure quietly carried five times a share of an Azure disk bill.
  const prices = { ...WESTEUROPE_PRICES, disk: { 'Premium SSD Managed Disks|P20': 80.54 } };
  const withStorage: ClusterPlan = {
    ...plan,
    storage: { tier: 'premium-ssd', requestedGiB: 300, disk: { name: 'P20', gib: 512 }, wastedGiB: 212 },
  };
  const compare = (p: ClusterPlan) =>
    compareModels(req, { prices, dedicated: { plan: p, pool: pool('Standard_D16s_v5', 3) } });

  const onPrem = (p: ClusterPlan) => compare(p).find(c => c.model === 'on-premises')!;
  const dedicated = (p: ClusterPlan) => compare(p).find(c => c.model === 'dedicated-cluster')!;

  it('leaves storage out of the on-premises figure entirely', () => {
    expect(onPrem(withStorage).amount).toBeCloseTo(onPrem(plan).amount!, 2);
  });

  it('still includes it in the dedicated cluster, which really does pay Azure', () => {
    expect(dedicated(withStorage).amount).toBeGreaterThan(dedicated(plan).amount!);
  });

  it('says so, rather than silently dropping it', () => {
    expect(onPrem(withStorage).estimate!.assumptions.join(' ')).toMatch(
      /storage is NOT included/i,
    );
  });

  it('adds no such note when no storage was asked for', () => {
    expect(onPrem(plan).estimate!.assumptions.join(' ')).not.toMatch(/NOT included/);
  });
});
