import { estimateCost } from './cost.js';
import { DEFAULT_OVERRIDES } from './types.js';
import type {
  ClusterPlan,
  CostEstimate,
  DeploymentModel,
  ModelComparison,
  NodePoolPlan,
  PriceTable,
  PricingOverrides,
  SizingRequest,
  Sku,
} from './types.js';

/**
 * Compare where a workload could run.
 *
 * Only the dedicated ARO cluster has a real, metered price - the Azure Retail
 * Prices API. The other two are DERIVED FROM IT using demo multipliers, because
 * neither has a pricing API:
 *
 *   shared namespace -> 50% of the dedicated cluster of the same size
 *   on-premises      -> 5x the dedicated cluster of the same size
 *
 * These multipliers are invented for demonstration. They are not benchmarks, not
 * Red Hat guidance, and not derived from anything. Every surface that shows them
 * says so, and they are never tagged as an Azure price. Change them in
 * DEMO_MULTIPLIERS, or replace the whole approach with real figures.
 */

/** Invented for the demo. Not a benchmark. See the note above. */
export const DEMO_MULTIPLIERS = {
  /** A namespace is assumed to cost half a dedicated cluster of the same size. */
  sharedNamespace: 0.5,
  /** On-premises is assumed to cost five times a dedicated cluster, per month. */
  onPremises: 5,
} as const;

const LABELS: Record<DeploymentModel, string> = {
  'shared-namespace': 'Namespace on a shared cluster',
  'dedicated-cluster': 'Dedicated ARO cluster',
  'on-premises': 'On-premises OpenShift',
};

const TRADEOFFS: Record<DeploymentModel, string[]> = {
  'shared-namespace': [
    'Fastest to provision - minutes, not hours.',
    'No cluster to upgrade, patch or pay a control plane for.',
    'Blast radius and noisy-neighbour risk are shared with other teams.',
    'Cluster-scoped changes (operators, CRDs, node config) need the platform team.',
  ],
  'dedicated-cluster': [
    'Full control: operators, CRDs, node sizing, upgrade timing.',
    'Isolation is a cluster boundary, not a namespace boundary.',
    'Carries its own control plane and licence cost regardless of utilisation.',
    'Someone owns its lifecycle - upgrades, capacity, certificates.',
  ],
  'on-premises': [
    'Data stays on infrastructure you own, which may be the deciding factor.',
    'Capacity is bought ahead of demand; bursting is not an option.',
    'You carry hardware, power, cooling, DC space and the staff to run them.',
    'Much of the real cost is fixed and already committed, so a monthly figure is a smoothed approximation.',
  ],
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;

/**
 * Build an estimate derived from the dedicated-cluster cost by a flat multiplier.
 *
 * Scales on the vCPU the user ASKED FOR, not on the cluster's node-rounded total.
 * A dedicated cluster's price steps - 30 and 44 vCPU both buy the same three
 * nodes, so the cost is genuinely identical. A namespace is a slice of requested
 * capacity, so it should move continuously as the request moves; inheriting the
 * cluster's plateau made the figure look frozen.
 */
function derivedEstimate(
  base: CostEstimate,
  baseVcpu: number,
  requestedVcpu: number,
  multiplier: number,
  label: string,
  rationale: string,
  opts: PricingOverrides,
): CostEstimate {
  // Cost per ALLOCATABLE vCPU of the costed cluster, then scaled to the
  // allocatable vCPU requested. Both sides must be the same unit: dividing by raw
  // pool vCPU while multiplying by allocatable requested vCPU made a "50%"
  // multiplier land at 41.7%.
  const perVcpuHourly = baseVcpu > 0 ? base.hourly / baseVcpu : 0;
  const hourly = round4(perVcpuHourly * requestedVcpu * multiplier);
  const monthly = round2(hourly * opts.hoursPerMonth);

  return {
    currency: base.currency,
    region: base.region,
    lines: [
      {
        label,
        detail: `${multiplier}x the dedicated cluster's per-vCPU rate, for ${requestedVcpu} vCPU`,
        hourly,
        source: 'assumption',
        sourceNote: `ASSUMPTION FOR THE DEMO: ${rationale}`,
        included: true,
      },
    ],
    hourly,
    monthly,
    yearly: round2(monthly * 12),
    hoursPerMonth: opts.hoursPerMonth,
    assumptions: [
      `ASSUMPTION FOR THE DEMO, NOT A REAL PRICE: ${rationale} ` +
        'This figure is invented to make the comparison concrete. It is not a ' +
        'benchmark, not Red Hat guidance, and not derived from any measurement. ' +
        'Replace it with your own figures before using this to make a decision.',
    ],
  };
}

/**
 * A rate someone configured, if they configured one.
 *
 * These exist so the invented demo multipliers can be replaced with real figures
 * without touching code. A configured rate takes precedence and is described by
 * its own note; otherwise the multiplier applies and says so.
 */
function configuredRate(
  opts: PricingOverrides,
  model: 'shared-namespace' | 'on-premises',
): { perVcpuHour: number; note: string | null } | null {
  const rate =
    model === 'shared-namespace' ? opts.sharedClusterPerVcpuHour : opts.onPremPerVcpuHour;
  if (rate === null || rate === undefined) return null;
  const note = model === 'shared-namespace' ? opts.sharedClusterNote : opts.onPremNote;
  return { perVcpuHour: rate, note };
}

/** Cost a model straight from a configured per-vCPU rate. */
function ratedEstimate(
  rate: { perVcpuHour: number; note: string | null },
  requestedVcpu: number,
  label: string,
  opts: PricingOverrides,
  currency: string,
  region: string,
): CostEstimate {
  const hourly = round4(rate.perVcpuHour * requestedVcpu);
  const monthly = round2(hourly * opts.hoursPerMonth);
  const provenance = rate.note ?? 'Locally configured rate; no public meter exists for this.';
  return {
    currency,
    region,
    lines: [
      {
        label,
        detail: `${requestedVcpu} vCPU at $${rate.perVcpuHour}/vCPU/hr`,
        hourly,
        source: 'override',
        sourceNote: `CONFIGURED RATE: ${provenance}`,
        included: true,
      },
    ],
    hourly,
    monthly,
    yearly: round2(monthly * 12),
    hoursPerMonth: opts.hoursPerMonth,
    assumptions: [
      `This figure uses a locally configured rate, not a published price. ${provenance}`,
    ],
  };
}

export interface CompareOptions {
  prices: PriceTable;
  /** The costed dedicated-cluster option, from recommendNodePools + estimateCost. */
  dedicated: { plan: ClusterPlan; pool: NodePoolPlan; controlPlaneSku?: Sku };
  overrides?: Partial<PricingOverrides>;
}

export function compareModels(
  req: SizingRequest,
  options: CompareOptions,
): ModelComparison[] {
  const opts: PricingOverrides = { ...DEFAULT_OVERRIDES, ...(options.overrides ?? {}) };
  const { prices, dedicated } = options;

  const dedicatedEstimate = estimateCost(dedicated.plan, prices, opts);

  /*
   * On-premises is derived from the dedicated cluster's COMPUTE cost only.
   *
   * Persistent volume storage is an Azure managed disk priced per provisioned
   * tier. Multiplying that by the on-prem factor would be nonsense: an
   * organisation buying its own storage buys arrays up front on a separate
   * cycle, and nothing about Azure disk pricing carries over. Leaving it in
   * meant the on-premises figure quietly contained five times a share of an
   * Azure disk bill, while the form told the user storage was costed
   * separately.
   */
  const storageHourly = dedicatedEstimate.lines
    .filter(l => l.included && l.label.startsWith('Persistent volume storage'))
    .reduce((sum, l) => sum + l.hourly, 0);
  const computeOnly: CostEstimate = {
    ...dedicatedEstimate,
    hourly: round4(dedicatedEstimate.hourly - storageHourly),
  };

  // --- Dedicated ARO cluster: the only metered price here ---------------------
  const dedicatedEntry: ModelComparison = {
    model: 'dedicated-cluster',
    label: LABELS['dedicated-cluster'],
    billing: 'monthly',
    amount: dedicatedEstimate.monthly,
    estimate: dedicatedEstimate,
    summary:
      `${dedicated.pool.nodes} x ${dedicated.pool.sku.name} in ${req.region}, ` +
      `priced from the Azure Retail Prices API.`,
    tradeoffs: TRADEOFFS['dedicated-cluster'],
  };

  // --- Shared namespace: half the dedicated cluster ---------------------------
  const sharedRate = configuredRate(opts, 'shared-namespace');
  const sharedEstimate = sharedRate
    ? ratedEstimate(sharedRate, req.vcpu, `Shared cluster allocation - ${req.vcpu} vCPU`, opts, prices.currency, prices.region)
    : derivedEstimate(
    dedicatedEstimate,
    dedicated.pool.allocatableVcpu,
    req.vcpu,
    DEMO_MULTIPLIERS.sharedNamespace,
    `Shared cluster allocation - ${req.vcpu} vCPU`,
    `a namespace is assumed to cost ${DEMO_MULTIPLIERS.sharedNamespace * 100}% of a ` +
      'dedicated cluster of the same size, on the basis that it shares a control ' +
      'plane and spare capacity with other tenants.',
    opts,
  );
  const sharedEntry: ModelComparison = {
    model: 'shared-namespace',
    label: LABELS['shared-namespace'],
    billing: 'monthly',
    amount: sharedEstimate.monthly,
    estimate: sharedEstimate,
    summary: `A ${req.vcpu} vCPU / ${req.ramGiB} GiB slice of a cluster that already exists.`,
    tradeoffs: TRADEOFFS['shared-namespace'],
  };

  // --- On-premises: five times, monthly ---------------------------------------
  const onPremRate = configuredRate(opts, 'on-premises');
  const onPremEstimate = onPremRate
    ? ratedEstimate(onPremRate, req.vcpu, `On-premises capacity - ${req.vcpu} vCPU`, opts, prices.currency, prices.region)
    : derivedEstimate(
    computeOnly,
    dedicated.pool.allocatableVcpu,
    req.vcpu,
    DEMO_MULTIPLIERS.onPremises,
    `On-premises capacity - ${req.vcpu} vCPU`,
    `on-premises is assumed to cost ${DEMO_MULTIPLIERS.onPremises}x a dedicated ` +
      'cluster of the same size, amortised to a monthly figure covering hardware, ' +
      'licences, power and the people to run it.',
    opts,
  );
  if (storageHourly > 0) {
    onPremEstimate.assumptions.push(
      'Persistent volume storage is NOT included. On-premises storage is bought ' +
        'separately, up front, on its own cycle - there is no managed disk to ' +
        'price and the Azure figure does not carry over.',
    );
  }

  const onPremEntry: ModelComparison = {
    model: 'on-premises',
    label: LABELS['on-premises'],
    billing: 'monthly',
    amount: onPremEstimate.monthly,
    estimate: onPremEstimate,
    summary:
      `${req.vcpu} vCPU of on-premises capacity. There is no hourly meter behind ` +
      'this - it is an amortised estimate, not a bill.',
    tradeoffs: TRADEOFFS['on-premises'],
  };

  // Always cost all three. The caller decides what to show; the UI needs a figure
  // for every option so a user can see what the alternatives would cost before
  // switching to one. Returning only the selected model left the others blank.
  return [sharedEntry, dedicatedEntry, onPremEntry];
}

/**
 * The cheapest model, by its headline monthly figure.
 *
 * Returns null unless at least two are priced and all are billed the same way -
 * declaring a winner against a single option, or across different billing bases,
 * would be worse than saying nothing.
 */
export function cheapestPriced(comparisons: ModelComparison[]): ModelComparison | null {
  const priced = comparisons.filter(c => c.amount !== null);
  if (priced.length < 2) return null;
  if (new Set(priced.map(c => c.billing)).size > 1) return null;
  return priced.reduce((a, b) => (a.amount! <= b.amount! ? a : b));
}
