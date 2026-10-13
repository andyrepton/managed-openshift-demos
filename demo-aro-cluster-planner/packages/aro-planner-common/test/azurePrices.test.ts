import { describe, expect, it, vi } from 'vitest';

import {
  fetchAroLicencePrices,
  fetchDiskPrices,
  fetchVmPrices,
  isLinuxOnDemand,
} from '../src/azurePrices.js';

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

describe('fetchDiskPrices', () => {
  // Every managed disk SKU has three meters, and they are not distinguishable
  // by skuName or by unit. Taking the wrong one priced a 2 TiB E40 below a
  // 512 GiB E20 - cheaper for more storage, which no one would question.
  const rows = [
    { productName: 'Standard SSD Managed Disks', skuName: 'E40 LRS', meterName: 'E40 LRS Disk Mount', retailPrice: 17.082, unitOfMeasure: '1/Month' },
    { productName: 'Standard SSD Managed Disks', skuName: 'E40 LRS', meterName: 'E40 LRS Disk', retailPrice: 153.6, unitOfMeasure: '1/Month' },
    { productName: 'Standard SSD Managed Disks', skuName: 'E40 LRS', meterName: 'E40 LRS Disk Operations', retailPrice: 0.002, unitOfMeasure: '10K' },
    { productName: 'Standard SSD Managed Disks', skuName: 'E40 ZRS', meterName: 'E40 ZRS Disk', retailPrice: 230.4, unitOfMeasure: '1/Month' },
    { productName: 'Premium SSD Managed Disks', skuName: 'P20 LRS', meterName: 'P20 LRS Disk', retailPrice: 80.54, unitOfMeasure: '1/Month' },
  ].map(r => ({ armSkuName: '', currencyCode: 'USD', armRegionName: 'westeurope', type: 'Consumption', ...r }));

  const fetchStub = async () =>
    ({ ok: true, status: 200, json: async () => ({ Items: rows, NextPageLink: null }) }) as unknown as Response;

  it('takes the disk meter, not the mount fee or the IO meter', async () => {
    const out = await fetchDiskPrices('westeurope', { fetchFn: fetchStub });
    expect(out['Standard SSD Managed Disks|E40']).toBe(153.6);
    expect(out['Premium SSD Managed Disks|P20']).toBe(80.54);
  });

  it('ignores ZRS, which is about 30% dearer than the LRS we size for', async () => {
    const out = await fetchDiskPrices('westeurope', { fetchFn: fetchStub });
    expect(Object.values(out)).not.toContain(230.4);
  });

  it('never returns the per-IO transaction meter as a disk price', async () => {
    const out = await fetchDiskPrices('westeurope', { fetchFn: fetchStub });
    expect(Object.values(out)).not.toContain(0.002);
  });
});
