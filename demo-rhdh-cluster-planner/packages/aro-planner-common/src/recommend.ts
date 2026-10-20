import type { NodePoolPlan, PriceTable, SizingRequest, Sku } from './types.js';
import { operatorFootprint, withOperatorCapacity } from './operators.js';
import {
  MAX_WORKER_NODES,
  MIN_WORKER_NODES,
  NODE_OVERHEAD_RAM_GIB,
  NODE_OVERHEAD_VCPU,
  allocatableRamGiB,
  allocatableVcpu,
  categoriesForProfile,
  findSkus,
} from './skus.js';

/** Availability zones to spread across when HA is requested. */
export const AZ_COUNT = 3;

export interface Recommendation extends NodePoolPlan {
  /** Hourly VM cost of the pool, when a price table was supplied. */
  hourlyVmCost?: number;
}

export interface RecommendOptions {
  /** Ranks candidates by cost when supplied; otherwise ranks by wasted capacity. */
  prices?: PriceTable;
  /** How many candidates to return. */
  limit?: number;
}

/**
 * Nodes needed to satisfy the request with this SKU, honouring ARO's minimums.
 *
 * The caller's vCPU/RAM figures are treated as *allocatable* - what their pods can
 * actually request - so per-node OpenShift overhead is subtracted before dividing.
 * Sizing against raw VM specs is the classic way to end up ~15% short.
 */
export function nodesRequired(sku: Sku, req: SizingRequest): number | null {
  const perNodeVcpu = allocatableVcpu(sku);
  const perNodeRam = allocatableRamGiB(sku);

  // A node too small to have anything left after overhead can never satisfy anything.
  if (perNodeVcpu <= 0 || perNodeRam <= 0) return null;

  const byVcpu = Math.ceil(req.vcpu / perNodeVcpu);
  const byRam = Math.ceil(req.ramGiB / perNodeRam);
  let nodes = Math.max(byVcpu, byRam, MIN_WORKER_NODES);

  // Even spread across AZs, so losing a zone costs a predictable third.
  if (req.highAvailability && nodes % AZ_COUNT !== 0) {
    nodes += AZ_COUNT - (nodes % AZ_COUNT);
  }

  if (nodes > MAX_WORKER_NODES) return null;
  return nodes;
}

function buildPlan(sku: Sku, nodes: number, req: SizingRequest): NodePoolPlan {
  const totalVcpu = sku.vcpu * nodes;
  const totalRamGiB = sku.ramGiB * nodes;
  const allocVcpu = allocatableVcpu(sku) * nodes;
  const allocRam = allocatableRamGiB(sku) * nodes;

  // How much of the allocatable capacity the request does not use. Averaging the two
  // dimensions avoids favouring a SKU that fits vCPU perfectly but wastes huge RAM.
  const vcpuWaste = allocVcpu > 0 ? 1 - req.vcpu / allocVcpu : 1;
  const ramWaste = allocRam > 0 ? 1 - req.ramGiB / allocRam : 1;
  const waste = Math.max(0, (vcpuWaste + ramWaste) / 2);

  const rationale: string[] = [];
  rationale.push(
    `${nodes} x ${sku.name} (${sku.vcpu} vCPU / ${sku.ramGiB} GiB each) in the ` +
      `${sku.category} family.`,
  );
  rationale.push(
    `Reserving ${NODE_OVERHEAD_VCPU} vCPU and ${NODE_OVERHEAD_RAM_GIB} GiB per node for ` +
      `OpenShift leaves ${allocVcpu} vCPU and ${allocRam} GiB allocatable, against the ` +
      `${req.vcpu} vCPU / ${req.ramGiB} GiB requested.`,
  );

  // Say so when the figures above are bigger than what the user typed, or the
  // node count looks wrong against their own request.
  const operators = operatorFootprint(req.operators);
  if (operators.items.length > 0) {
    rationale.push(
      `Includes ${operators.vcpu} vCPU and ${operators.ramGiB} GiB for ` +
        `${operators.items.map(o => o.label).join(', ')}, on top of the workload itself.`,
    );
  }

  const byVcpu = Math.ceil(req.vcpu / allocatableVcpu(sku));
  const byRam = Math.ceil(req.ramGiB / allocatableRamGiB(sku));
  if (byRam > byVcpu) {
    rationale.push('Memory is the binding constraint - node count is driven by RAM, not vCPU.');
  } else if (byVcpu > byRam) {
    rationale.push('vCPU is the binding constraint - node count is driven by CPU, not RAM.');
  }

  if (Math.max(byVcpu, byRam) < MIN_WORKER_NODES) {
    rationale.push(
      `Rounded up to the ${MIN_WORKER_NODES}-worker minimum that ARO's support policy requires.`,
    );
  } else if (req.highAvailability && Math.max(byVcpu, byRam, MIN_WORKER_NODES) !== nodes) {
    rationale.push(`Rounded up to a multiple of ${AZ_COUNT} for an even availability-zone spread.`);
  }

  if (sku.day2Only) {
    rationale.push(
      'Microsoft supports this size only as a day-2 node pool addition, not at cluster install time.',
    );
  }
  if (sku.minVersion) {
    rationale.push(`Requires ARO ${sku.minVersion} or newer.`);
  }

  return {
    sku,
    nodes,
    totalVcpu,
    totalRamGiB,
    allocatableVcpu: allocVcpu,
    allocatableRamGiB: allocRam,
    waste,
    rationale,
  };
}

/**
 * Rank worker node pool options for a request, best first.
 *
 * Ranks on cost when a price table is available, because that is what the user is
 * actually being asked to decide about. Without prices it falls back to wasted
 * capacity, which is the best proxy available offline.
 */
export function recommendNodePools(
  request: SizingRequest,
  options: RecommendOptions = {},
): Recommendation[] {
  const { prices, limit = 3 } = options;

  // Selected operators are capacity like any other. Folding them in here rather
  // than at each call site is what stops the wizard, the MCP tools and the CLI
  // from disagreeing about whether Kafka was counted.
  const req = withOperatorCapacity(request);

  if (req.vcpu <= 0 || req.ramGiB <= 0) return [];

  const candidates = findSkus({
    role: 'worker',
    categories: categoriesForProfile(req.profile),
    allowDay2Only: req.dayTwo,
    ...(req.openshiftVersion ? { openshiftVersion: req.openshiftVersion } : {}),
  });

  const scored: Recommendation[] = [];
  for (const sku of candidates) {
    const nodes = nodesRequired(sku, req);
    if (nodes === null) continue;

    const plan = buildPlan(sku, nodes, req);
    const vmPrice = prices?.vm[sku.name];

    // With prices supplied, a SKU Azure does not sell in this region is not an option.
    if (prices && vmPrice === undefined) continue;

    scored.push(vmPrice === undefined ? plan : { ...plan, hourlyVmCost: vmPrice * nodes });
  }

  scored.sort((a, b) => {
    if (a.hourlyVmCost !== undefined && b.hourlyVmCost !== undefined) {
      if (a.hourlyVmCost !== b.hourlyVmCost) return a.hourlyVmCost - b.hourlyVmCost;
    }
    if (a.waste !== b.waste) return a.waste - b.waste;
    // Fewer, larger nodes are cheaper to operate at equal cost and waste.
    if (a.nodes !== b.nodes) return a.nodes - b.nodes;
    return a.sku.name.localeCompare(b.sku.name);
  });

  return scored.slice(0, limit);
}
