/**
 * Persistent volume storage, as Azure actually sells it.
 *
 * This covers PVCs - dynamically provisioned managed disks that back persistent
 * volumes in the cluster. It is NOT the node OS disks, which are a separate line
 * in the estimate.
 *
 * The thing that catches people out: Azure bills a managed disk at its
 * PROVISIONED TIER, not per GiB used. A 300 GiB PVC is billed as a P20 (512
 * GiB), so you pay for 512. Capacity is bought in whole units, exactly like
 * nodes, and pricing it per-GiB understates every request that is not already
 * sitting on a tier boundary.
 */

export type StorageTier = 'premium-ssd' | 'standard-ssd';

export interface DiskSize {
  /** Azure's name for the tier, e.g. `P20`. */
  name: string;
  /** Provisioned capacity in GiB. You are billed for this, not for what you use. */
  gib: number;
}

/**
 * Premium and Standard SSD share the same capacity ladder; only the prefix and
 * the price differ. Sizes from Microsoft's managed disk pricing tables.
 */
const LADDER: { suffix: number; gib: number }[] = [
  { suffix: 1, gib: 4 },
  { suffix: 2, gib: 8 },
  { suffix: 3, gib: 16 },
  { suffix: 4, gib: 32 },
  { suffix: 6, gib: 64 },
  { suffix: 10, gib: 128 },
  { suffix: 15, gib: 256 },
  { suffix: 20, gib: 512 },
  { suffix: 30, gib: 1024 },
  { suffix: 40, gib: 2048 },
  { suffix: 50, gib: 4096 },
  { suffix: 60, gib: 8192 },
  { suffix: 70, gib: 16384 },
  { suffix: 80, gib: 32767 },
];

const PREFIX: Record<StorageTier, string> = {
  'premium-ssd': 'P',
  'standard-ssd': 'E',
};

export const STORAGE_TIER_LABEL: Record<StorageTier, string> = {
  'premium-ssd': 'Premium SSD',
  'standard-ssd': 'Standard SSD',
};

/** Azure `productName` for each tier, used to match the retail price meters. */
export const STORAGE_PRODUCT: Record<StorageTier, string> = {
  'premium-ssd': 'Premium SSD Managed Disks',
  'standard-ssd': 'Standard SSD Managed Disks',
};

export function diskSizes(tier: StorageTier): DiskSize[] {
  return LADDER.map(l => ({ name: `${PREFIX[tier]}${l.suffix}`, gib: l.gib }));
}

/**
 * The smallest disk that holds `gib`.
 *
 * Null above the largest tier: a request bigger than 32 TiB needs several disks
 * and a conversation, not a silently truncated answer.
 */
export function diskFor(gib: number, tier: StorageTier): DiskSize | null {
  if (!Number.isFinite(gib) || gib <= 0) return null;
  return diskSizes(tier).find(d => d.gib >= gib) ?? null;
}

/** Key into `PriceTable.disk`: `<productName>|<tier name>`, e.g. `...|P20`. */
export function diskMeterKey(tier: StorageTier, sizeName: string): string {
  return `${STORAGE_PRODUCT[tier]}|${sizeName}`;
}

export interface StoragePlan {
  tier: StorageTier;
  /** What was asked for. */
  requestedGiB: number;
  /** The tier it lands on, and therefore what is billed. */
  disk: DiskSize;
  /** Provisioned minus requested - paid for and unusable. */
  wastedGiB: number;
}

/**
 * Work out what a storage request actually buys.
 *
 * Returns null when nothing was asked for, so callers can leave storage out of
 * the estimate entirely rather than showing a zero.
 */
export function planStorage(gib: number, tier: StorageTier): StoragePlan | null {
  const disk = diskFor(gib, tier);
  if (!disk) return null;
  return {
    tier,
    requestedGiB: gib,
    disk,
    wastedGiB: disk.gib - gib,
  };
}

/**
 * The StorageClass a tier needs.
 *
 * ARO ships exactly one disk StorageClass: `managed-csi`, which is Premium_LRS
 * and the cluster default. Standard SSD is NOT available out of the box - so
 * choosing it without also creating a class would price Standard while the
 * cluster quietly provisioned Premium.
 */
export interface StorageClassPlan {
  name: string;
  /** False when ARO already provides it and nothing needs applying. */
  mustCreate: boolean;
  /** Azure disk SKU behind it. */
  skuName: string;
}

export function storageClassFor(tier: StorageTier): StorageClassPlan {
  return tier === 'premium-ssd'
    ? { name: 'managed-csi', mustCreate: false, skuName: 'Premium_LRS' }
    : { name: 'managed-csi-standard', mustCreate: true, skuName: 'StandardSSD_LRS' };
}
