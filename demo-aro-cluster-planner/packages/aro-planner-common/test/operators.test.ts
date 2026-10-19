import { describe, expect, it } from 'vitest';

import {
  OPERATOR_CATALOG,
  OPERATOR_IDS,
  isOperatorId,
  operatorById,
  operatorFootprint,
  withOperatorCapacity,
} from '../src/operators.js';
import { recommendNodePools } from '../src/recommend.js';
import type { SizingRequest } from '../src/types.js';

const baseRequest: SizingRequest = {
  flavour: 'hcp',
  region: 'westeurope',
  vcpu: 40,
  ramGiB: 160,
  profile: 'general',
  highAvailability: true,
  dayTwo: false,
};

describe('the approved catalog', () => {
  it('gives every operator a package name and a catalog source', () => {
    for (const o of OPERATOR_CATALOG) {
      expect(o.packageName, `${o.id} has no package name`).toBeTruthy();
      expect(o.catalog).toMatch(/^(redhat|certified|community)-operators$/);
    }
  });

  it('marks community operators as unsupported, because that is the whole distinction', () => {
    for (const o of OPERATOR_CATALOG) {
      expect(o.supported).toBe(o.catalog !== 'community-operators');
    }
  });

  it('states a footprint and where it came from for every entry', () => {
    for (const o of OPERATOR_CATALOG) {
      if (o.costedSeparately) {
        // Its capacity is dedicated nodes, costed as their own pool. A nonzero
        // figure here would be added to the worker sizing as well.
        expect(o.vcpu).toBe(0);
        expect(o.ramGiB).toBe(0);
        expect(o.dedicatedNodes).toBeGreaterThan(0);
      } else {
        expect(o.vcpu).toBeGreaterThan(0);
        expect(o.ramGiB).toBeGreaterThan(0);
      }
      expect(o.sourceNote.length).toBeGreaterThan(20);
    }
  });

  it('has no duplicate ids or package names', () => {
    expect(new Set(OPERATOR_IDS).size).toBe(OPERATOR_CATALOG.length);
    expect(new Set(OPERATOR_CATALOG.map(o => o.packageName)).size).toBe(OPERATOR_CATALOG.length);
  });
});

describe('isOperatorId', () => {
  it('accepts catalog ids and rejects everything else', () => {
    expect(isOperatorId('rhbk')).toBe(true);
    expect(isOperatorId('amq-streams')).toBe(true);
    expect(isOperatorId('nope')).toBe(false);
    expect(isOperatorId(undefined)).toBe(false);
    expect(isOperatorId(7)).toBe(false);
  });
});

describe('operatorFootprint', () => {
  it('is zero for no selection', () => {
    expect(operatorFootprint([])).toMatchObject({ vcpu: 0, ramGiB: 0, hasUnsupported: false });
    expect(operatorFootprint(undefined).items).toEqual([]);
  });

  it('sums the selected entries', () => {
    const rhbk = operatorById('rhbk')!;
    const kafka = operatorById('amq-streams')!;
    const f = operatorFootprint(['rhbk', 'amq-streams']);
    expect(f.vcpu).toBeCloseTo(rhbk.vcpu + kafka.vcpu, 2);
    expect(f.ramGiB).toBeCloseTo(rhbk.ramGiB + kafka.ramGiB, 2);
    expect(f.items).toHaveLength(2);
  });

  it('counts a duplicate once - an operator installed twice is installed once', () => {
    const once = operatorFootprint(['rhbk']);
    const twice = operatorFootprint(['rhbk', 'rhbk']);
    expect(twice.vcpu).toBe(once.vcpu);
    expect(twice.items).toHaveLength(1);
  });

  it('ignores an unknown id rather than throwing, so a stale plan still prices', () => {
    const f = operatorFootprint(['rhbk', 'gone' as never]);
    expect(f.items).toHaveLength(1);
    expect(f.vcpu).toBe(operatorById('rhbk')!.vcpu);
  });

  it('rounds, so floating point does not leak into the UI', () => {
    const f = operatorFootprint(OPERATOR_IDS);
    expect(f.vcpu.toString()).not.toMatch(/\d{6,}/);
    expect(f.ramGiB.toString()).not.toMatch(/\d{6,}/);
  });

  it('leaves ODF out of the worker totals - its nodes are costed separately', () => {
    // The double-count guard. ODF's three dedicated nodes are a pool in
    // cost.ts; adding capacity for them here would bill the same hardware
    // twice, and the total would look merely high rather than wrong.
    const withoutOdf = operatorFootprint(['rhbk']);
    const withOdf = operatorFootprint(['rhbk', 'odf']);
    expect(withOdf.vcpu).toBe(withoutOdf.vcpu);
    expect(withOdf.ramGiB).toBe(withoutOdf.ramGiB);
  });

  it('still lists ODF, so the plan records that it was asked for', () => {
    const f = operatorFootprint(['odf']);
    expect(f.items.map(o => o.id)).toEqual(['odf']);
    expect(f.vcpu).toBe(0);
  });

  it('does not change the recommended pool when ODF is added', () => {
    const base = recommendNodePools({ ...baseRequest, operators: ['rhbk'] }, { limit: 1 })[0]!;
    const odf = recommendNodePools(
      { ...baseRequest, operators: ['rhbk', 'odf'] },
      { limit: 1 },
    )[0]!;
    expect(odf.nodes).toBe(base.nodes);
    expect(odf.sku.name).toBe(base.sku.name);
  });

  it('flags a community selection', () => {
    expect(operatorFootprint(['flink']).hasUnsupported).toBe(true);
    expect(operatorFootprint(['rhbk', 'amq-streams']).hasUnsupported).toBe(false);
  });
});

describe('withOperatorCapacity', () => {
  it('leaves a request with no operators untouched', () => {
    expect(withOperatorCapacity(baseRequest)).toBe(baseRequest);
  });

  it('adds the footprint to the capacity being sized for', () => {
    const req = withOperatorCapacity({ ...baseRequest, operators: ['amq-streams'] });
    const kafka = operatorById('amq-streams')!;
    expect(req.vcpu).toBeCloseTo(40 + kafka.vcpu, 2);
    expect(req.ramGiB).toBeCloseTo(160 + kafka.ramGiB, 2);
  });

  it('keeps the operator list, so the plan can still explain the delta', () => {
    const req = withOperatorCapacity({ ...baseRequest, operators: ['rhbk'] });
    expect(req.operators).toEqual(['rhbk']);
  });
});

describe('sizing with operators', () => {
  it('never recommends less capacity than the same request without them', () => {
    const without = recommendNodePools(baseRequest, { limit: 1 })[0]!;
    const with_ = recommendNodePools(
      { ...baseRequest, operators: ['rhbk', 'amq-streams', 'flink'] },
      { limit: 1 },
    )[0]!;
    expect(with_.allocatableVcpu).toBeGreaterThanOrEqual(without.allocatableVcpu);
    expect(with_.allocatableRamGiB).toBeGreaterThanOrEqual(without.allocatableRamGiB);
  });

  it('fits the combined workload and operator capacity', () => {
    const f = operatorFootprint(['rhbk', 'amq-streams']);
    const rec = recommendNodePools(
      { ...baseRequest, operators: ['rhbk', 'amq-streams'] },
      { limit: 1 },
    )[0]!;
    expect(rec.allocatableVcpu).toBeGreaterThanOrEqual(baseRequest.vcpu + f.vcpu);
    expect(rec.allocatableRamGiB).toBeGreaterThanOrEqual(baseRequest.ramGiB + f.ramGiB);
  });

  it('says in the rationale where the extra capacity went', () => {
    const rec = recommendNodePools({ ...baseRequest, operators: ['flink'] }, { limit: 1 })[0]!;
    expect(rec.rationale.join(' ')).toMatch(/Apache Flink/);
  });
});
