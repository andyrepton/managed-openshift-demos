import type { AroFlavour, NodeRole, Sku, SkuCategory, WorkloadProfile } from './types.js';
import { SKU_CATALOG, SKU_CATALOG_SOURCE } from './generated/sku-catalog.js';

export { SKU_CATALOG, SKU_CATALOG_SOURCE };

/**
 * Per-node capacity OpenShift keeps for itself (kubelet, CRI-O, systemd, and the
 * daemonsets every node runs). Workload capacity is what's left after this.
 *
 * These are deliberately round numbers rather than a reimplementation of OpenShift's
 * piecewise `system-reserved` formula: being approximately right and obviously
 * approximate beats being precisely wrong when the node shape is still hypothetical.
 * The reservation is reported in the plan so the reader can see what was deducted.
 */
export const NODE_OVERHEAD_VCPU = 1;
export const NODE_OVERHEAD_RAM_GIB = 4;

/** ARO requires at least three workers on a standard cluster. */
export const MIN_WORKER_NODES = 3;

/** Microsoft caps a cluster at 250 workers. */
export const MAX_WORKER_NODES = 250;

/** Which SKU categories suit each workload profile, best fit first. */
const PROFILE_CATEGORIES: Record<WorkloadProfile, SkuCategory[]> = {
  general: ['general-purpose', 'memory-optimized', 'compute-optimized'],
  'memory-heavy': ['memory-optimized', 'general-purpose'],
  'compute-heavy': ['compute-optimized', 'general-purpose'],
  'storage-heavy': ['storage-optimized', 'memory-optimized'],
  gpu: ['gpu'],
};

export function categoriesForProfile(profile: WorkloadProfile): SkuCategory[] {
  return PROFILE_CATEGORIES[profile];
}

/**
 * Pick a profile from the shape of the request when the user hasn't stated one.
 * The thresholds are the natural breakpoints between Azure's families: Fsv2 is
 * 1:2 vCPU:RAM, Dsv5 is 1:4, Esv5 is 1:8.
 */
export function inferProfile(vcpu: number, ramGiB: number): WorkloadProfile {
  if (vcpu <= 0) return 'general';
  const ratio = ramGiB / vcpu;
  if (ratio <= 2.5) return 'compute-heavy';
  if (ratio >= 7) return 'memory-heavy';
  return 'general';
}

export function allocatableVcpu(sku: Sku): number {
  return Math.max(0, sku.vcpu - NODE_OVERHEAD_VCPU);
}

export function allocatableRamGiB(sku: Sku): number {
  return Math.max(0, sku.ramGiB - NODE_OVERHEAD_RAM_GIB);
}

/** Compare two X.Y[.Z] version strings. Returns <0, 0 or >0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(n => Number.parseInt(n, 10) || 0);
  const pb = b.split('.').map(n => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export interface SkuFilter {
  role?: NodeRole;
  categories?: SkuCategory[];
  /** Permit sizes Microsoft only supports as a day-2 node pool addition. */
  allowDay2Only?: boolean;
  /** Drop sizes that need a newer ARO version than this. */
  openshiftVersion?: string;
}

export function findSkus(filter: SkuFilter = {}): Sku[] {
  const { role, categories, allowDay2Only = false, openshiftVersion } = filter;

  return SKU_CATALOG.filter(sku => {
    if (role && sku.role !== role) return false;
    if (categories && !categories.includes(sku.category)) return false;
    if (!allowDay2Only && sku.day2Only) return false;
    if (openshiftVersion && sku.minVersion && compareVersions(openshiftVersion, sku.minVersion) < 0) {
      return false;
    }
    return true;
  }).map(sku => ({ ...sku }));
}

export function getSku(name: string, role: NodeRole = 'worker'): Sku | undefined {
  const found = SKU_CATALOG.find(s => s.name === name && s.role === role);
  return found ? { ...found } : undefined;
}

// ---------------------------------------------------------------------------
// ARO licence meters
// ---------------------------------------------------------------------------

/**
 * Map a SKU to the `productName` of its ARO licence meter in the Azure Retail
 * Prices API, under `serviceName = 'Virtual Machines Licenses'`.
 *
 * The rate is flat per vCPU across every category, so getting this mapping slightly
 * wrong costs accuracy only where Microsoft's rounding differs between meters. It
 * still matters for traceability: the estimate cites the meter it used.
 */
export function licenceProductName(sku: Sku, flavour: AroFlavour): string {
  if (sku.category === 'gpu') {
    // Three separate GPU product lines, chosen by series prefix.
    if (/^Standard_ND/i.test(sku.name)) return 'Azure Red Hat OpenShift GPU Accelerated ND';
    if (/^Standard_NV/i.test(sku.name)) return 'Azure Red Hat OpenShift GPU Accelerated NV';
    return 'Azure Red Hat OpenShift GPU Accelerated NC';
  }

  switch (sku.category) {
    case 'memory-optimized':
    // M-series has no dedicated meter; Microsoft bills it against Memory Optimized.
    case 'memory-and-compute-optimized':
      return 'Azure Red Hat OpenShift Memory Optimized';
    case 'compute-optimized':
      // The only category for which an explicit HCP product line is published.
      return flavour === 'hcp'
        ? 'Azure Red Hat OpenShift Compute Optimized HCP'
        : 'Azure Red Hat OpenShift Compute Optimized';
    case 'storage-optimized':
      return 'Azure Red Hat OpenShift Storage Optimized';
    case 'general-purpose':
    default:
      return 'Azure Red Hat OpenShift General Purpose';
  }
}

export function licenceMeterKey(productName: string, vcpu: number): string {
  return `${productName}|${vcpu}`;
}
