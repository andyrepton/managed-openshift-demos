import { describe, expect, it, vi } from 'vitest';

import { fetchAroLicencePrices, fetchVmPrices, isLinuxOnDemand } from '../src/azurePrices.js';

/** The six rows the live API really returns for a single D8s_v5 query in westeurope. */
const D8S_V5_ROWS = [
  { armSkuName: 'Standard_D8s_v5', productName: 'Virtual Machines Dsv5 Series Windows', skuName: 'Standard_D8s_v5 Spot', meterName: 'D8s v5 Spot', retailPrice: 0.153014 },
  { armSkuName: 'Standard_D8s_v5', productName: 'Virtual Machines Dsv5 Series', skuName: 'Standard_D8s_v5', meterName: 'D8s v5', retailPrice: 0.46 },
  { armSkuName: 'Standard_D8s_v5', productName: 'Virtual Machines Dsv5 Series', skuName: 'Standard_D8s_v5 Low Priority', meterName: 'D8s v5 Low Priority', retailPrice: 0.092 },
  { armSkuName: 'Standard_D8s_v5', productName: 'Virtual Machines Dsv5 Series', skuName: 'Standard_D8s_v5 Spot', meterName: 'D8s v5 Spot', retailPrice: 0.085008 },
  { armSkuName: 'Standard_D8s_v5', productName: 'Virtual Machines Dsv5 Series Windows', skuName: 'Standard_D8s_v5', meterName: 'D8s v5', retailPrice: 0.828 },
  { armSkuName: 'Standard_D8s_v5', productName: 'Virtual Machines Dsv5 Series Windows', skuName: 'Standard_D8s_v5 Low Priority', meterName: 'D8s v5 Low Priority', retailPrice: 0.331 },
];

function mockFetch(pages: unknown[][]) {
  let i = 0;
  return vi.fn(async () => {
    const Items = pages[Math.min(i, pages.length - 1)] ?? [];
    const NextPageLink = i < pages.length - 1 ? `https://example.invalid/page${++i}` : null;
    if (NextPageLink === null) i++;
    return { ok: true, status: 200, statusText: 'OK', json: async () => ({ Items, NextPageLink }) } as unknown as Response;
  });
}

describe('isLinuxOnDemand', () => {
  it('selects exactly one row out of the six the API returns', () => {
    const kept = D8S_V5_ROWS.filter(isLinuxOnDemand);
    expect(kept).toHaveLength(1);
    expect(kept[0]?.retailPrice).toBe(0.46);
  });

  it('rejects Spot, Low Priority and Windows', () => {
    // Spot is 5.4x cheaper than on-demand here - picking it by accident would make
    // an entire cluster estimate silently, catastrophically wrong.
    for (const row of D8S_V5_ROWS.filter(r => r.retailPrice !== 0.46)) {
      expect(isLinuxOnDemand(row)).toBe(false);
    }
  });
});

describe('fetchVmPrices', () => {
  it('returns only the Linux on-demand price', async () => {
    const f = mockFetch([D8S_V5_ROWS]);
    const out = await fetchVmPrices(['Standard_D8s_v5'], 'westeurope', { fetchImpl: f as never });
    expect(out).toEqual({ Standard_D8s_v5: 0.46 });
  });

  it('chunks large SKU lists so the OData filter stays within the API limit', async () => {
    // Measured live: ~15 clauses is the ceiling before 400 Bad Request.
    const f = mockFetch([[]]);
    const skus = Array.from({ length: 30 }, (_, i) => `Standard_D${i}s_v5`);
    await fetchVmPrices(skus, 'westeurope', { fetchImpl: f as never });

    expect(f.mock.calls.length).toBeGreaterThan(1);
    for (const [url] of f.mock.calls) {
      const filter = new URL(url as string).searchParams.get('$filter') ?? '';
      expect(filter.split(' or ').length).toBeLessThanOrEqual(12);
      expect(filter.length).toBeLessThan(635);
    }
  });

  it('deduplicates repeated SKU names', async () => {
    const f = mockFetch([[]]);
    await fetchVmPrices(['Standard_D8s_v5', 'Standard_D8s_v5'], 'westeurope', { fetchImpl: f as never });
    expect(f.mock.calls).toHaveLength(1);
  });
});

describe('fetchAroLicencePrices', () => {
  it('keys meters by product name and vCPU count', async () => {
    const f = mockFetch([[
      { productName: 'Azure Red Hat OpenShift General Purpose', meterName: '8 vCPU', retailPrice: 0.342 },
      { productName: 'Azure Red Hat OpenShift Memory Optimized', meterName: '32 vCPU', retailPrice: 1.368 },
      // Some meters carry a suffix, e.g. "24 vCPU AROO" - the number must still parse.
      { productName: 'Azure Red Hat OpenShift Compute Optimized HCP', meterName: '24 vCPU AROO', retailPrice: 1.026 },
    ]]);
    const out = await fetchAroLicencePrices({ fetchImpl: f as never });

    expect(out['Azure Red Hat OpenShift General Purpose|8']).toBe(0.342);
    expect(out['Azure Red Hat OpenShift Memory Optimized|32']).toBe(1.368);
    expect(out['Azure Red Hat OpenShift Compute Optimized HCP|24']).toBe(1.026);
  });

  it('throws rather than returning nothing if the API shape changes', async () => {
    // Silently returning {} would price every cluster at the fallback rate with no
    // warning, which is exactly the failure mode this guard exists to prevent.
    const f = mockFetch([[]]);
    await expect(fetchAroLicencePrices({ fetchImpl: f as never })).rejects.toThrow(
      /No ARO licence meters found/,
    );
  });
});

describe('error handling', () => {
  it('does not retry a 400, which means the filter is wrong', async () => {
    const f = vi.fn(async () => ({ ok: false, status: 400, statusText: 'Bad Request' }) as unknown as Response);
    await expect(
      fetchVmPrices(['Standard_D8s_v5'], 'westeurope', { fetchImpl: f as never }),
    ).rejects.toThrow(/400/);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('retries a 429 and succeeds when the rate limit clears', async () => {
    let n = 0;
    const f = vi.fn(async () => {
      if (++n === 1) return { ok: false, status: 429, statusText: 'Too Many Requests' } as unknown as Response;
      return {
        ok: true, status: 200, statusText: 'OK',
        json: async () => ({ Items: D8S_V5_ROWS, NextPageLink: null }),
      } as unknown as Response;
    });
    const out = await fetchVmPrices(['Standard_D8s_v5'], 'westeurope', { fetchImpl: f as never });
    expect(out).toEqual({ Standard_D8s_v5: 0.46 });
    expect(n).toBe(2);
  });
});
