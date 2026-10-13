import type { PriceTable, Sku } from './types.js';
import { licenceMeterKey } from './skus.js';
import { STORAGE_PRODUCT } from './storage.js';

/**
 * Client for the Azure Retail Prices API.
 *
 * Unauthenticated and free, but it does not send CORS headers, so this must run
 * server-side (the backend proxy or the MCP server) and never from the browser.
 *
 * https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices
 */

const ENDPOINT = 'https://prices.azure.com/api/retail/prices';

/** Flat ARO licence rate per worker vCPU per hour, used when no exact meter exists. */
export const ARO_LICENCE_PER_VCPU_FALLBACK = 0.0428;

interface RetailItem {
  armSkuName: string;
  productName: string;
  skuName: string;
  meterName: string;
  retailPrice: number;
  currencyCode: string;
  armRegionName: string;
  type: string;
  unitOfMeasure: string;
}

interface RetailPage {
  Items: RetailItem[];
  NextPageLink: string | null;
}

export interface FetchOptions {
  currency?: string;
  /** Injectable for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

/**
 * Maximum `armSkuName eq '...'` clauses per request.
 *
 * Measured against the live API: 15 clauses (~635 char filter) succeeds, 18 (~742)
 * returns `BadRequest: Invalid OData parameters supplied`. Twelve leaves headroom,
 * since SKU names vary in length and the limit appears to be on the filter string
 * rather than the clause count.
 */
const MAX_SKUS_PER_QUERY = 12;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** The API rate-limits with 429 under even modest fan-out, so back off and retry. */
async function fetchWithRetry(
  url: string,
  opts: FetchOptions,
  attempts = 4,
): Promise<Response> {
  const doFetch = opts.fetchImpl ?? fetch;
  let lastStatus = 0;

  for (let i = 0; i < attempts; i++) {
    const res = await doFetch(url, opts.signal ? { signal: opts.signal } : {});
    if (res.ok) return res;
    lastStatus = res.status;

    // 429 and 5xx are worth retrying; 400 means our filter is wrong and never will be.
    if (res.status !== 429 && res.status < 500) {
      throw new Error(
        `Azure Retail Prices API returned ${res.status} ${res.statusText}. ` +
          (res.status === 400
            ? 'This usually means the OData filter was too long or malformed.'
            : ''),
      );
    }
    if (i < attempts - 1) await sleep(500 * 2 ** i);
  }
  throw new Error(
    `Azure Retail Prices API still returning ${lastStatus} after ${attempts} attempts.`,
  );
}

async function queryAll(filter: string, opts: FetchOptions): Promise<RetailItem[]> {
  const params = new URLSearchParams({ $filter: filter });
  if (opts.currency) params.set('currencyCode', opts.currency);

  let url: string | null = `${ENDPOINT}?${params.toString()}`;
  const items: RetailItem[] = [];

  // The API caps pages at 100 items and links onward via NextPageLink.
  while (url) {
    const res = await fetchWithRetry(url, opts);
    const page = (await res.json()) as RetailPage;
    items.push(...page.Items);
    url = page.NextPageLink;
  }
  return items;
}

/**
 * Pick the single Linux pay-as-you-go row for a VM SKU.
 *
 * A query for one `armSkuName` returns roughly six rows - Linux and Windows, each in
 * standard, Spot and Low Priority variants. Taking the first row, or the cheapest,
 * silently prices the cluster as Spot. This is the most dangerous trap in the whole
 * pricing path, so it is isolated here and asserted in tests.
 */
export function isLinuxOnDemand(item: RetailItem): boolean {
  return (
    !item.productName.includes('Windows') &&
    !item.skuName.includes('Spot') &&
    !item.skuName.includes('Low Priority')
  );
}

/** Fetch Linux on-demand hourly prices for specific VM SKUs in one region. */
export async function fetchVmPrices(
  skuNames: readonly string[],
  region: string,
  opts: FetchOptions = {},
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const unique = [...new Set(skuNames)];

  // Chunked so the OData filter stays within the API's length limit, and issued
  // sequentially rather than in parallel to stay under its rate limit.
  for (let i = 0; i < unique.length; i += MAX_SKUS_PER_QUERY) {
    const chunk = unique.slice(i, i + MAX_SKUS_PER_QUERY);
    const names = chunk.map(n => `armSkuName eq '${n}'`).join(' or ');
    const filter =
      `serviceName eq 'Virtual Machines' and armRegionName eq '${region}' ` +
      `and priceType eq 'Consumption' and (${names})`;

    for (const item of await queryAll(filter, opts)) {
      if (!isLinuxOnDemand(item)) continue;
      // Deliberately keep the first match; duplicates would indicate an API change.
      if (out[item.armSkuName] === undefined) out[item.armSkuName] = item.retailPrice;
    }
  }
  return out;
}

/**
 * Fetch the ARO licence meters.
 *
 * These are NOT under `serviceName eq 'Azure Red Hat OpenShift'` - that returns zero
 * results. They live under `Virtual Machines Licenses` with an `Azure Red Hat
 * OpenShift <category>` product name, and are globally priced rather than per-region.
 */
export async function fetchAroLicencePrices(
  opts: FetchOptions = {},
): Promise<Record<string, number>> {
  const items = await queryAll(
    "contains(productName,'OpenShift') and priceType eq 'Consumption'",
    opts,
  );

  const out: Record<string, number> = {};
  for (const item of items) {
    // meterName looks like "8 vCPU", sometimes suffixed ("24 vCPU AROO").
    const m = /^(\d+)\s+vCPU/.exec(item.meterName);
    if (!m?.[1]) continue;
    const key = licenceMeterKey(item.productName, Number.parseInt(m[1], 10));
    if (out[key] === undefined) out[key] = item.retailPrice;
  }

  if (Object.keys(out).length === 0) {
    // Fail loudly: silently returning nothing here would price every cluster's
    // licence at the fallback rate without anyone noticing the API had changed.
    throw new Error(
      "No ARO licence meters found. The Retail Prices API shape has probably changed - " +
        "check that productName still contains 'OpenShift' under 'Virtual Machines Licenses'.",
    );
  }
  return out;
}

/**
 * Managed disk prices, for the PVCs a namespace will provision.
 *
 * Billed per provisioned disk per month, so `unitOfMeasure` is `1/Month` and
 * the retail price is the whole disk - not a rate per GiB. The transaction
 * meters ("Disk Transactions", `/10K`) are filtered out: they are per-IO and
 * cannot be estimated from a capacity request.
 *
 * ZRS is skipped in favour of LRS. Taking whichever row arrived first would
 * pick ZRS about half the time and overstate storage by roughly 30%, which is
 * the same trap as Spot pricing on the VM meters.
 */
export async function fetchDiskPrices(
  region: string,
  opts: FetchOptions = {},
): Promise<Record<string, number>> {
  const products = Object.values(STORAGE_PRODUCT);
  const filter =
    `serviceName eq 'Storage' and armRegionName eq '${region}' ` +
    `and priceType eq 'Consumption' and (` +
    products.map(p => `productName eq '${p}'`).join(' or ') +
    ')';

  const out: Record<string, number> = {};
  for (const item of await queryAll(filter, opts)) {
    // Match on meterName, not skuName. Every disk SKU has THREE meters and they
    // are not distinguishable by skuName or unit:
    //
    //   E40 LRS Disk Mount          17.082  1/Month   <- shared-disk mount fee
    //   E40 LRS Disk               153.600  1/Month   <- the disk itself
    //   E40 LRS Disk Operations      0.002  10K       <- per-IO
    //
    // Filtering on unitOfMeasure alone leaves the first two, and taking
    // whichever arrived first priced E40 below E20. Same trap as Spot pricing
    // on the VM meters: several plausible rows, only one of them correct.
    const m = /^([PE]\d+) LRS Disk$/.exec(item.meterName);
    if (!m?.[1] || item.unitOfMeasure !== '1/Month') continue;
    out[`${item.productName}|${m[1]}`] = item.retailPrice;
  }
  return out;
}

/** Build a complete PriceTable for the SKUs a plan needs. */
export async function buildPriceTable(
  skus: readonly Sku[],
  region: string,
  opts: FetchOptions = {},
): Promise<PriceTable> {
  const [vm, aroLicence, disk] = await Promise.all([
    fetchVmPrices(skus.map(s => s.name), region, opts),
    fetchAroLicencePrices(opts),
    // Storage is optional: a failure here must not stop a cluster being priced,
    // so it degrades to an unpriced storage line rather than a failed request.
    fetchDiskPrices(region, opts).catch(() => ({})),
  ]);

  return {
    currency: opts.currency ?? 'USD',
    region,
    vm,
    disk,
    aroLicence,
    aroLicencePerVcpu: ARO_LICENCE_PER_VCPU_FALLBACK,
    retrievedAt: new Date().toISOString(),
  };
}
