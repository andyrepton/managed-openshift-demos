/**
 * Object storage: Azure Blob, or ODF's own gateway.
 *
 * Blob is sold per GB stored per month, and unlike managed disks there is no
 * provisioned tier to round up to - you pay for what you hold. That is the
 * single biggest reason the same capacity costs so differently here than on
 * ODF, where capacity is bought as whole replicated disks on dedicated nodes.
 *
 * The rate is GRADUATED, not a cliff. Azure publishes three bands for Hot LRS
 * and bills each slice at its own rate, so 100 TB is not 100 TB at the 50 TB+
 * price - it is the first 50 TB at one rate and the rest at another. Picking a
 * single band is wrong in both directions depending on which you pick, so the
 * bands are applied properly below.
 */

export type ObjectBackend = 'azure-blob' | 'odf';

/**
 * The meter.
 *
 * `General Block Blob v2` is the GPv2 account type, which is what a current
 * deployment uses. The legacy `Blob Storage` product publishes a meter with an
 * identical name and nearly identical prices, so matching on `meterName` alone
 * returns both and the result depends on arrival order - the same trap the disk
 * meters set.
 */
export const BLOB_PRODUCT = 'General Block Blob v2';
export const BLOB_SKU = 'Hot LRS';
export const BLOB_METER = 'Hot LRS Data Stored';

/** One published price band. `minGiB` is the point at which this rate starts. */
export interface BlobTier {
  minGiB: number;
  perGiBMonth: number;
}

/**
 * Monthly cost of holding `gib` in Blob, applying the bands cumulatively.
 *
 * Returns null with no tiers, so the caller shows "unpriced" rather than free.
 */
export function blobMonthly(gib: number, tiers: readonly BlobTier[] | undefined): number | null {
  if (!tiers || tiers.length === 0) return null;
  if (!Number.isFinite(gib) || gib <= 0) return 0;

  const bands = [...tiers].sort((a, b) => a.minGiB - b.minGiB);
  let total = 0;

  for (let i = 0; i < bands.length; i++) {
    const band = bands[i]!;
    if (gib <= band.minGiB) break;
    // This band runs until the next one starts, or forever if it is the last.
    const next = bands[i + 1]?.minGiB ?? Infinity;
    const slice = Math.min(gib, next) - band.minGiB;
    total += slice * band.perGiBMonth;
  }

  return Math.round(total * 1e6) / 1e6;
}

/** The rate the last GB lands on, for explaining the figure. */
export function blobMarginalRate(
  gib: number,
  tiers: readonly BlobTier[] | undefined,
): number | null {
  if (!tiers || tiers.length === 0) return null;
  const bands = [...tiers].sort((a, b) => a.minGiB - b.minGiB);
  let rate = bands[0]!.perGiBMonth;
  for (const band of bands) {
    if (gib > band.minGiB) rate = band.perGiBMonth;
  }
  return rate;
}

export interface ObjectStoragePlan {
  backend: ObjectBackend;
  gib: number;
  /** What Blob would charge, whichever backend is chosen. Null if unpriced. */
  blobMonthly: number | null;
  /** Rate the last GB falls on, for the source note. */
  blobMarginalRate: number | null;
}

/**
 * Work out the object storage position.
 *
 * `blobMonthly` is computed even when the backend is ODF, deliberately. The
 * whole point of offering both is the size of the gap, and a number you have to
 * toggle back and forth to see is not a comparison. The cost panel renders it
 * as an excluded line when ODF is serving the capacity.
 */
export function planObjectStorage(
  gib: number,
  backend: ObjectBackend,
  tiers: readonly BlobTier[] | undefined,
): ObjectStoragePlan | null {
  if (!Number.isFinite(gib) || gib <= 0) return null;
  return {
    backend,
    gib,
    blobMonthly: blobMonthly(gib, tiers),
    blobMarginalRate: blobMarginalRate(gib, tiers),
  };
}
