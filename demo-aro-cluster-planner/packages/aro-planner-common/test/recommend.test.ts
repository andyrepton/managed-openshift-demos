import { describe, expect, it } from 'vitest';

import { AZ_COUNT, nodesRequired, recommendNodePools } from '../src/recommend.js';
import { MIN_WORKER_NODES, getSku, inferProfile } from '../src/skus.js';
import type { SizingRequest } from '../src/types.js';
import { WESTEUROPE_PRICES } from './fixtures.js';

const base: SizingRequest = {
  flavour: 'hcp',
  region: 'westeurope',
  vcpu: 40,
  ramGiB: 160,
  profile: 'general',
  highAvailability: true,
  dayTwo: false,
};

describe('inferProfile', () => {
  it('reads the family from the RAM:vCPU ratio', () => {
    expect(inferProfile(16, 32)).toBe('compute-heavy'); // 1:2, Fsv2 shape
    expect(inferProfile(16, 64)).toBe('general'); // 1:4, Dsv5 shape
    expect(inferProfile(16, 128)).toBe('memory-heavy'); // 1:8, Esv5 shape
  });

  it('does not divide by zero on an empty request', () => {
    expect(inferProfile(0, 0)).toBe('general');
  });
});

describe('nodesRequired', () => {
  const d8 = getSku('Standard_D8s_v5', 'worker')!;

  it('sizes against allocatable capacity, not raw VM specs', () => {
    // D8s_v5 is 8 vCPU / 32 GiB raw, but 7 vCPU / 28 GiB allocatable.
    // 40 vCPU needs ceil(40/7) = 6; 160 GiB needs ceil(160/28) = 6.
    expect(nodesRequired(d8, { ...base, highAvailability: false })).toBe(6);
  });

  it('would under-provision if raw specs were used', () => {
    // Against raw specs 160/32 = 5 nodes, which would not actually fit the workload.
    expect(nodesRequired(d8, { ...base, highAvailability: false })).toBeGreaterThan(5);
  });

  it('enforces the three-worker minimum from the ARO support policy', () => {
    const tiny = { ...base, vcpu: 1, ramGiB: 1, highAvailability: false };
    expect(nodesRequired(d8, tiny)).toBe(MIN_WORKER_NODES);
  });

  it('rounds up to a multiple of three for an even AZ spread', () => {
    const req = { ...base, vcpu: 50, ramGiB: 100 };
    const n = nodesRequired(d8, req);
    expect(n! % AZ_COUNT).toBe(0);
  });

  it('returns null when the request cannot fit inside the 250-worker cap', () => {
    expect(nodesRequired(d8, { ...base, vcpu: 100000, ramGiB: 100000 })).toBeNull();
  });
});

describe('recommendNodePools', () => {
  it('returns the cheapest options first when prices are available', () => {
    const recs = recommendNodePools(base, { prices: WESTEUROPE_PRICES });
    expect(recs.length).toBeGreaterThan(0);

    const costs = recs.map(r => r.hourlyVmCost!);
    expect(costs).toEqual([...costs].sort((a, b) => a - b));
  });

  it('only offers SKUs Azure actually sells in the region', () => {
    const recs = recommendNodePools(base, { prices: WESTEUROPE_PRICES });
    for (const r of recs) {
      expect(WESTEUROPE_PRICES.vm[r.sku.name]).toBeDefined();
    }
  });

  it('every recommendation actually satisfies the request', () => {
    for (const r of recommendNodePools(base, { prices: WESTEUROPE_PRICES })) {
      expect(r.allocatableVcpu).toBeGreaterThanOrEqual(base.vcpu);
      expect(r.allocatableRamGiB).toBeGreaterThanOrEqual(base.ramGiB);
    }
  });

  it('excludes day-2-only sizes when building a new cluster', () => {
    const recs = recommendNodePools(
      { ...base, profile: 'memory-heavy', dayTwo: false },
      { limit: 50 },
    );
    expect(recs.every(r => !r.sku.day2Only)).toBe(true);
  });

  it('allows day-2-only sizes when adding a pool to an existing cluster', () => {
    const newCluster = recommendNodePools(
      { ...base, profile: 'memory-heavy', dayTwo: false },
      { limit: 100 },
    );
    const dayTwo = recommendNodePools(
      { ...base, profile: 'memory-heavy', dayTwo: true },
      { limit: 100 },
    );
    expect(dayTwo.length).toBeGreaterThan(newCluster.length);
  });

  it('respects the cluster OpenShift version for version-gated sizes', () => {
    const old = recommendNodePools({ ...base, openshiftVersion: '4.18' }, { limit: 100 });
    expect(old.every(r => r.sku.name.includes('_v6') === false)).toBe(true);

    const current = recommendNodePools({ ...base, openshiftVersion: '4.22' }, { limit: 100 });
    expect(current.some(r => r.sku.minVersion === '4.19')).toBe(true);
  });

  it('picks memory-optimised families for a memory-heavy profile', () => {
    const recs = recommendNodePools({ ...base, vcpu: 16, ramGiB: 256, profile: 'memory-heavy' });
    expect(recs[0]?.sku.category).toBe('memory-optimized');
  });

  it('explains its reasoning', () => {
    const [top] = recommendNodePools(base, { prices: WESTEUROPE_PRICES });
    expect(top?.rationale.join(' ')).toContain('Reserving');
  });

  it('returns nothing for an empty request rather than throwing', () => {
    expect(recommendNodePools({ ...base, vcpu: 0, ramGiB: 0 })).toEqual([]);
  });
});
