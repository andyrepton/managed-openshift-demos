/** Domain model shared by the wizard UI, the backend price proxy and the MCP server. */

import type { OperatorId } from './operators.js';
import type { StoragePlan, StorageTier } from './storage.js';

export type SkuCategory =
  | 'general-purpose'
  | 'memory-optimized'
  | 'compute-optimized'
  | 'memory-and-compute-optimized'
  | 'storage-optimized'
  | 'gpu';

export type NodeRole = 'control-plane' | 'worker';

/** One entry from Microsoft's published list of ARO-supported VM sizes. */
export interface Sku {
  name: string;
  series: string;
  vcpu: number;
  ramGiB: number;
  category: SkuCategory;
  role: NodeRole;
  /** Not valid at cluster-install time; can only be added as a day-2 node pool. */
  day2Only: boolean;
  /** Minimum ARO version, where Microsoft states one. */
  minVersion?: string;
}

/** Standard ARO (customer-visible control plane) vs hosted control planes. */
export type AroFlavour = 'classic' | 'hcp';

/**
 * Where a workload could run. The planner compares these so the choice of whether
 * to use ARO at all is made on evidence rather than instinct.
 */
export type DeploymentModel = 'shared-namespace' | 'dedicated-cluster' | 'on-premises';

export type WorkloadProfile =
  | 'general'
  | 'memory-heavy'
  | 'compute-heavy'
  | 'storage-heavy'
  | 'gpu';

export interface SizingRequest {
  flavour: AroFlavour;
  /** Azure `armRegionName`, e.g. `westeurope`. */
  region: string;
  /** vCPU the team's workloads need. Treated as *allocatable*, not raw. */
  vcpu: number;
  /** RAM in GiB the team's workloads need. Treated as *allocatable*. */
  ramGiB: number;
  profile: WorkloadProfile;
  /** Spread nodes evenly across three availability zones. */
  highAvailability: boolean;
  /** Adding a pool to an existing cluster, which permits day-2-only sizes. */
  dayTwo: boolean;
  openshiftVersion?: string;
  /**
   * Persistent volume storage in GiB, across all PVCs. 0 or absent means none,
   * and storage is then left out of the estimate rather than shown as zero.
   */
  storageGiB?: number;
  /** Managed disk tier backing those PVCs. Defaults to Premium SSD, as ARO does. */
  storageTier?: StorageTier;
  /** Which model the user has chosen. Drives what the UI shows and what is emitted. */
  deploymentModel?: DeploymentModel;
  /** The application this is for. Used to name the namespace and the artifacts. */
  applicationName?: string;
  /**
   * Operators the team asked for, from the approved list in `operators.ts`.
   *
   * These add to `vcpu` and `ramGiB` before sizing - see `withOperatorCapacity`.
   * The fields above stay as the user typed them, so the plan can show the
   * workload and the platform separately rather than one inflated number.
   */
  operators?: OperatorId[];
}

/** A concrete worker pool: one SKU, a node count, and what that actually yields. */
export interface NodePoolPlan {
  sku: Sku;
  nodes: number;
  /** Raw totals across the pool. */
  totalVcpu: number;
  totalRamGiB: number;
  /** Totals after subtracting per-node OpenShift overhead. */
  allocatableVcpu: number;
  allocatableRamGiB: number;
  /** Fraction of raw capacity not usable by the request, 0..1. Lower is tighter. */
  waste: number;
  /** Human-readable justification, surfaced in the UI and the plan document. */
  rationale: string[];
}

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

/**
 * Where a number came from. The UI renders these differently, because
 * "Azure told us this" and "we guessed" must never look the same.
 */
export type PriceSource = 'azure-api' | 'override' | 'assumption';

export interface CostLine {
  label: string;
  detail?: string;
  hourly: number;
  source: PriceSource;
  /** Why this source, e.g. which meter, or why it is an assumption. */
  sourceNote?: string;
  /** False = displayed for transparency but not added to the total. */
  included: boolean;
}

export interface CostEstimate {
  currency: string;
  region: string;
  lines: CostLine[];
  hourly: number;
  monthly: number;
  yearly: number;
  hoursPerMonth: number;
  /** Everything the reader must know before trusting the total. */
  assumptions: string[];
}

/**
 * Prices resolved from the Azure Retail Prices API by the backend. Keeping this a
 * plain data structure is what makes the cost model a pure, testable function.
 */
export interface PriceTable {
  currency: string;
  region: string;
  /** `armSkuName` -> Linux on-demand $/hr. Excludes Windows, Spot and Low Priority. */
  vm: Record<string, number>;
  /**
   * `<productName>|<tier>` -> $/month per disk, e.g. `Premium SSD Managed Disks|P20`.
   * Monthly, not hourly: Azure bills managed disks per provisioned disk per month.
   */
  disk?: Record<string, number>;
  /** `<productName>|<vcpu>` -> $/hr, from the `Virtual Machines Licenses` meters. */
  aroLicence: Record<string, number>;
  /**
   * Flat ARO licence rate per worker vCPU per hour, used when no exact meter exists.
   * Observed as $0.0428 across every category.
   */
  aroLicencePerVcpu: number;
  retrievedAt: string;
  /** True when served from cache because Azure was unreachable. */
  stale?: boolean;
}

export interface PricingOverrides {
  /**
   * ARO HCP per-cluster control-plane fee, $/hr.
   *
   * Microsoft has not published this - it is absent from both the pricing page and
   * the Retail Prices API. `null` means "unknown", and the estimate will say so
   * rather than quietly pricing it at zero.
   */
  hcpControlPlanePerHour: number | null;
  /**
   * Cost of a vCPU-hour on a shared cluster someone already pays for. This is an
   * ALLOCATION, not a price: a share of an existing cluster's cost. There is no
   * Azure meter for it.
   */
  sharedClusterPerVcpuHour: number | null;
  sharedClusterNote: string | null;
  /**
   * Fully-loaded cost of an on-premises vCPU-hour: amortised hardware, power,
   * cooling, OpenShift subscription, staff. No pricing API exists for this - it is
   * whatever the organisation's own figures say.
   */
  onPremPerVcpuHour: number | null;
  onPremNote: string | null;
  /**
   * Where `hcpControlPlanePerHour` came from, surfaced verbatim in the estimate.
   * Required reading when the figure is borrowed from elsewhere rather than
   * published for ARO.
   */
  hcpControlPlaneNote: string | null;
  hoursPerMonth: number;
  /** OS disk per node. */
  osDiskGiB: number;
  osDiskPerGiBMonth: number | null;
}

export const DEFAULT_OVERRIDES: PricingOverrides = {
  hcpControlPlanePerHour: null,
  hcpControlPlaneNote: null,
  sharedClusterPerVcpuHour: null,
  sharedClusterNote: null,
  onPremPerVcpuHour: null,
  onPremNote: null,
  hoursPerMonth: 730,
  osDiskGiB: 128,
  osDiskPerGiBMonth: null,
};

export interface ClusterPlan {
  flavour: AroFlavour;
  region: string;
  /** Classic ARO only: three control plane nodes, charged as infra but not licensed. */
  controlPlaneSku?: Sku;
  workerPools: NodePoolPlan[];
  /** PVC-backed managed disks. Absent means no storage was asked for. */
  storage?: StoragePlan;
}

/** How a model's cost lands: a recurring bill, or a single capital outlay. */
export type BillingMode = 'monthly' | 'one-off';

/** One deployment model, costed as far as it honestly can be. */
export interface ModelComparison {
  model: DeploymentModel;
  label: string;
  /** Monthly for cloud, one-off for on-premises capacity you buy up front. */
  billing: BillingMode;
  /** The headline figure, in whatever `billing` says it is. */
  amount: number | null;
  /** Null when no rate is configured. Null means UNPRICED, never free. */
  estimate: CostEstimate | null;
  /** Why this model is or is not priced, and what the reader must know. */
  summary: string;
  /** Shown when `estimate` is null, explaining what is needed to price it. */
  unpricedReason?: string;
  /** Operational differences that cost alone does not capture. */
  tradeoffs: string[];
}
