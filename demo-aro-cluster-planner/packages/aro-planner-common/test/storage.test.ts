import { describe, expect, it } from 'vitest';

import { diskFor, diskMeterKey, planStorage } from '../src/storage.js';
import { estimateCost } from '../src/cost.js';
import { getSku } from '../src/skus.js';
import type { ClusterPlan, NodePoolPlan, PriceTable } from '../src/types.js';
import { WESTEUROPE_PRICES } from './fixtures.js';

describe('disk tiers', () => {
  it.each([
    [1, 'P1', 4],
    [4, 'P1', 4],
    [5, 'P2', 8],
    [100, 'P10', 128],
    [128, 'P10', 128],
    [129, 'P15', 256],
    [300, 'P20', 512],
    [512, 'P20', 512],
    [513, 'P30', 1024],
  ])('%i GiB lands on %s (%i GiB provisioned)', (gib, name, provisioned) => {
    const d = diskFor(gib, 'premium-ssd')!;
    expect(d.name).toBe(name);
    expect(d.gib).toBe(provisioned);
  });

  it('uses the E ladder for Standard SSD, same capacities', () => {
    expect(diskFor(300, 'standard-ssd')).toEqual({ name: 'E20', gib: 512 });
  });

  it.each([0, -5, Number.NaN])('returns null for %s rather than a tier', gib => {
    expect(diskFor(gib, 'premium-ssd')).toBeNull();
  });

  it('returns null above the largest tier rather than silently truncating', () => {
    // 32767 GiB is P80, the top of the ladder. More than that needs several
    // disks and a conversation, not a quietly wrong answer.
    expect(diskFor(32767, 'premium-ssd')?.name).toBe('P80');
    expect(diskFor(40000, 'premium-ssd')).toBeNull();
  });

  it('reports the capacity paid for and unusable', () => {
    expect(planStorage(300, 'premium-ssd')).toMatchObject({
      disk: { name: 'P20', gib: 512 },
      requestedGiB: 300,
      wastedGiB: 212,
    });
  });

  it('reports no waste on a tier boundary', () => {
    expect(planStorage(512, 'premium-ssd')?.wastedGiB).toBe(0);
  });
});

describe('storage in the estimate', () => {
  const sku = getSku('Standard_D16s_v5', 'worker')!;
  const pool: NodePoolPlan = {
    sku,
    nodes: 3,
    totalVcpu: 48,
    totalRamGiB: 192,
    allocatableVcpu: 45,
    allocatableRamGiB: 180,
    waste: 0,
    rationale: [],
  };
  const prices: PriceTable = {
    ...WESTEUROPE_PRICES,
    disk: { [diskMeterKey('premium-ssd', 'P20')]: 73.22 },
  };
  const plan = (storage?: ReturnType<typeof planStorage>): ClusterPlan => ({
    flavour: 'hcp',
    region: 'westeurope',
    workerPools: [pool],
    ...(storage ? { storage } : {}),
  });

  it('prices a disk from the Azure meter, per month converted to hourly', () => {
    const est = estimateCost(plan(planStorage(300, 'premium-ssd')), prices);
    const line = est.lines.find(l => l.label.includes('Persistent volume storage'))!;
    expect(line.source).toBe('azure-api');
    expect(line.included).toBe(true);
    expect(line.hourly).toBeCloseTo(73.22 / 730, 4);
    expect(line.detail).toBe('300 GiB requested, 512 GiB provisioned');
  });

  it('warns that the provisioned tier is what gets billed', () => {
    const est = estimateCost(plan(planStorage(300, 'premium-ssd')), prices);
    expect(est.assumptions.join(' ')).toMatch(/212 GiB is paid for and unusable/);
  });

  it('warns that many small PVCs cost more than one big disk', () => {
    const est = estimateCost(plan(planStorage(300, 'premium-ssd')), prices);
    expect(est.assumptions.join(' ')).toMatch(/splitting the same capacity across many small volumes/i);
  });

  it('excludes storage, loudly, when no meter is available', () => {
    const est = estimateCost(plan(planStorage(300, 'premium-ssd')), WESTEUROPE_PRICES);
    const line = est.lines.find(l => l.label.includes('Persistent volume storage'))!;
    expect(line.included).toBe(false);
    expect(line.source).toBe('assumption');
    expect(est.assumptions.join(' ')).toMatch(/no managed disk price was available/);
  });

  it('has no storage line at all when none was asked for', () => {
    const est = estimateCost(plan(), prices);
    expect(est.lines.some(l => l.label.includes('Persistent volume'))).toBe(false);
  });

  it('adds storage to the total', () => {
    const without = estimateCost(plan(), prices).monthly;
    const withStorage = estimateCost(plan(planStorage(300, 'premium-ssd')), prices).monthly;
    expect(withStorage - without).toBeCloseTo(73.22, 1);
  });
});
