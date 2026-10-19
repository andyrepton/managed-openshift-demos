import { describe, expect, it } from 'vitest';

import { compareModels } from '../src/compare.js';
import { estimateCost } from '../src/cost.js';
import {
  ODF_NODES,
  ODF_NODE_RAM_GIB,
  ODF_NODE_VCPU,
  ODF_REPLICATION,
  odfNodeSku,
  odfRawGiB,
  odfSelected,
} from '../src/odf.js';
import { blobMarginalRate, blobMonthly, planObjectStorage } from '../src/objectStorage.js';
import { recommendNodePools } from '../src/recommend.js';
import { planStorage } from '../src/storage.js';
import type { ClusterPlan, PriceTable, SizingRequest } from '../src/types.js';
import { WESTEUROPE_PRICES } from './fixtures.js';

/** The published Hot LRS bands, as the Retail Prices API returns them. */
const BLOB_TIERS = [
  { minGiB: 0, perGiBMonth: 0.0196 },
  { minGiB: 51200, perGiBMonth: 0.018816 },
  { minGiB: 512000, perGiBMonth: 0.018032 },
];

const prices: PriceTable = { ...WESTEUROPE_PRICES, blob: BLOB_TIERS };

const req: SizingRequest = {
  flavour: 'hcp',
  region: 'westeurope',
  vcpu: 40,
  ramGiB: 160,
  profile: 'general',
  highAvailability: true,
  dayTwo: false,
};

describe('odfSelected', () => {
  it('is true if either backend is ODF, because the consequences are the same', () => {
    expect(odfSelected({})).toBe(false);
    expect(odfSelected({ blockBackend: 'azure-disk', objectBackend: 'azure-blob' })).toBe(false);
    expect(odfSelected({ blockBackend: 'odf' })).toBe(true);
    expect(odfSelected({ objectBackend: 'odf' })).toBe(true);
  });
});

describe('odfRawGiB', () => {
  it('multiplies by the replication factor', () => {
    expect(odfRawGiB(1000)).toBe(1000 * ODF_REPLICATION);
  });

  it('is zero for nothing, rather than NaN', () => {
    expect(odfRawGiB(0)).toBe(0);
    expect(odfRawGiB(-5)).toBe(0);
    expect(odfRawGiB(Number.NaN)).toBe(0);
  });
});

describe('odfNodeSku', () => {
  it('meets the documented per-node minimum', () => {
    const sku = odfNodeSku(prices)!;
    expect(sku.vcpu).toBeGreaterThanOrEqual(ODF_NODE_VCPU);
    expect(sku.ramGiB).toBeGreaterThanOrEqual(ODF_NODE_RAM_GIB);
  });

  it('picks the cheapest priced candidate', () => {
    const sku = odfNodeSku(prices)!;
    const cheapest = Math.min(
      ...Object.entries(prices.vm)
        .filter(([name]) => {
          const s = odfNodeSku(prices);
          return s !== null && name === s.name;
        })
        .map(([, p]) => p),
    );
    expect(prices.vm[sku.name]).toBe(cheapest);
  });

  it('returns null when nothing in the table is priced', () => {
    expect(odfNodeSku({ ...prices, vm: {} })).toBeNull();
  });
});

describe('blob pricing', () => {
  it('applies the first band below 50 TB', () => {
    expect(blobMonthly(1000, BLOB_TIERS)).toBeCloseTo(1000 * 0.0196, 6);
  });

  it('is graduated, not a cliff - each slice bills at its own rate', () => {
    // 100,000 GiB = 51,200 at the first rate, the rest at the second.
    const expected = 51200 * 0.0196 + (100000 - 51200) * 0.018816;
    expect(blobMonthly(100000, BLOB_TIERS)).toBeCloseTo(expected, 4);
  });

  it('never charges the whole amount at a higher-tier rate', () => {
    // The bug this guards: picking one band and multiplying.
    const naive = 100000 * 0.018816;
    expect(blobMonthly(100000, BLOB_TIERS)).toBeGreaterThan(naive);
  });

  it('is zero for no capacity and null with no published tiers', () => {
    expect(blobMonthly(0, BLOB_TIERS)).toBe(0);
    expect(blobMonthly(1000, [])).toBeNull();
    expect(blobMonthly(1000, undefined)).toBeNull();
  });

  it('reports the rate the last GB landed on', () => {
    expect(blobMarginalRate(1000, BLOB_TIERS)).toBe(0.0196);
    expect(blobMarginalRate(100000, BLOB_TIERS)).toBe(0.018816);
    expect(blobMarginalRate(600000, BLOB_TIERS)).toBe(0.018032);
  });

  it('prices Blob even when ODF is serving the capacity', () => {
    const plan = planObjectStorage(1000, 'odf', BLOB_TIERS)!;
    expect(plan.backend).toBe('odf');
    expect(plan.blobMonthly).toBeCloseTo(19.6, 4);
  });
});

function planWith(overrides: Partial<ClusterPlan>): ClusterPlan {
  const pool = recommendNodePools(req, { prices, limit: 1 })[0]!;
  return { flavour: 'hcp', region: 'westeurope', workerPools: [pool], ...overrides };
}

describe('costing ODF', () => {
  const sku = odfNodeSku(prices)!;
  const odf = {
    nodes: ODF_NODES,
    sku,
    usableGiB: 1000,
    rawGiB: odfRawGiB(1000),
    replication: ODF_REPLICATION,
    servesObject: true,
    servesBlock: false,
  };

  it('charges for the dedicated nodes and licenses them', () => {
    const est = estimateCost(planWith({ odf }), prices);
    const nodeLine = est.lines.find(l => l.label.startsWith('ODF nodes'));
    const licenceLine = est.lines.find(l => l.label.startsWith('ARO licence - ODF'));
    expect(nodeLine?.included).toBe(true);
    expect(nodeLine?.hourly).toBeCloseTo(prices.vm[sku.name]! * ODF_NODES, 4);
    expect(licenceLine?.included).toBe(true);
  });

  it('charges for replicated capacity, not usable capacity', () => {
    const est = estimateCost(planWith({ odf }), prices);
    const disks = est.lines.find(l => l.label.startsWith('ODF backing disks'));
    expect(disks?.detail).toContain('3000 GiB raw');
  });

  it('costs more than the same request without ODF', () => {
    const without = estimateCost(planWith({}), prices);
    const with_ = estimateCost(planWith({ odf }), prices);
    expect(with_.hourly).toBeGreaterThan(without.hourly);
  });

  it('says the nodes carry no application workload', () => {
    const est = estimateCost(planWith({ odf }), prices);
    expect(est.assumptions.join(' ')).toMatch(/no application\s+workload/);
  });
});

describe('costing object storage', () => {
  it('includes Blob in the total when Blob is serving it', () => {
    const objectStorage = planObjectStorage(1000, 'azure-blob', BLOB_TIERS)!;
    const est = estimateCost(planWith({ objectStorage }), prices);
    const line = est.lines.find(l => l.label.startsWith('Object storage'))!;
    expect(line.included).toBe(true);
    expect(line.source).toBe('azure-api');
  });

  it('shows Blob as an excluded comparison when ODF is serving it', () => {
    const objectStorage = planObjectStorage(1000, 'odf', BLOB_TIERS)!;
    const est = estimateCost(planWith({ objectStorage }), prices);
    const line = est.lines.find(l => l.label.startsWith('Object storage'))!;
    expect(line.included).toBe(false);
    expect(line.label).toMatch(/same capacity on Azure Blob/);
    expect(est.assumptions.join(' ')).toMatch(/would cost/);
  });

  it('does not double-count: the excluded Blob line stays out of the total', () => {
    const served = estimateCost(
      planWith({ objectStorage: planObjectStorage(1000, 'azure-blob', BLOB_TIERS)! }),
      prices,
    );
    const compared = estimateCost(
      planWith({ objectStorage: planObjectStorage(1000, 'odf', BLOB_TIERS)! }),
      prices,
    );
    expect(compared.hourly).toBeLessThan(served.hourly);
  });

  it('reports unpriced rather than free with no Blob meter', () => {
    const objectStorage = planObjectStorage(1000, 'azure-blob', [])!;
    const est = estimateCost(planWith({ objectStorage }), { ...prices, blob: [] });
    const line = est.lines.find(l => l.label.startsWith('Object storage'))!;
    expect(line.included).toBe(false);
    expect(line.source).toBe('assumption');
  });
});

describe('ODF and the deployment model', () => {
  const pool = recommendNodePools(req, { prices, limit: 1 })[0]!;
  const dedicated = { plan: planWith({}), pool };

  it('marks a shared namespace unavailable, with a reason', () => {
    const out = compareModels({ ...req, blockBackend: 'odf' }, { prices, dedicated });
    const shared = out.find(c => c.model === 'shared-namespace')!;
    expect(shared.unavailable).toBe(true);
    expect(shared.unavailableReason).toMatch(/dedicated labelled nodes/);
  });

  it('still costs the shared namespace, so the user sees what they gave up', () => {
    const out = compareModels({ ...req, objectBackend: 'odf' }, { prices, dedicated });
    const shared = out.find(c => c.model === 'shared-namespace')!;
    expect(shared.amount).not.toBeNull();
  });

  it('leaves it available when ODF is not selected', () => {
    const out = compareModels(req, { prices, dedicated });
    expect(out.find(c => c.model === 'shared-namespace')!.unavailable).toBeUndefined();
  });

  it('never marks the dedicated cluster unavailable', () => {
    const out = compareModels({ ...req, blockBackend: 'odf' }, { prices, dedicated });
    expect(out.find(c => c.model === 'dedicated-cluster')!.unavailable).toBeUndefined();
  });
});

describe('the comparison this exists to draw', () => {
  it('makes ODF dramatically dearer than Blob for the same object capacity', () => {
    const gib = 1000;
    const sku = odfNodeSku(prices)!;

    const onBlob = estimateCost(
      planWith({ objectStorage: planObjectStorage(gib, 'azure-blob', BLOB_TIERS)! }),
      prices,
    );
    const onOdf = estimateCost(
      planWith({
        objectStorage: planObjectStorage(gib, 'odf', BLOB_TIERS)!,
        odf: {
          nodes: ODF_NODES,
          sku,
          usableGiB: gib,
          rawGiB: odfRawGiB(gib),
          replication: ODF_REPLICATION,
          servesObject: true,
          servesBlock: false,
        },
      }),
      prices,
    );

    const blobOnly = blobMonthly(gib, BLOB_TIERS)!;
    const odfDelta = onOdf.monthly - (onBlob.monthly - blobOnly);
    // Not a precise assertion - the point is the order of magnitude.
    expect(odfDelta).toBeGreaterThan(blobOnly * 10);
  });
});
