import type {
  ClusterPlan,
  CostEstimate,
  CostLine,
  PriceTable,
  PricingOverrides,
  Sku,
} from './types.js';
import { DEFAULT_OVERRIDES } from './types.js';
import { licenceMeterKey, licenceProductName } from './skus.js';
import { ODF_NODES, ODF_NODE_RAM_GIB, ODF_NODE_VCPU } from './odf.js';
import { BLOB_PRODUCT, BLOB_SKU } from './objectStorage.js';
import { STORAGE_TIER_LABEL, diskFor, diskMeterKey } from './storage.js';

/** Classic ARO always runs exactly three control plane nodes. */
export const CONTROL_PLANE_NODES = 3;

export class MissingPriceError extends Error {
  constructor(public readonly skuName: string, public readonly region: string) {
    super(
      `No price for ${skuName} in ${region}. The Retail Prices API returned nothing ` +
        `for this SKU/region pair - it may not be offered there.`,
    );
    this.name = 'MissingPriceError';
  }
}

function vmHourly(prices: PriceTable, sku: Sku): number {
  const price = prices.vm[sku.name];
  if (price === undefined) throw new MissingPriceError(sku.name, prices.region);
  return price;
}

/**
 * ARO licence cost for a pool.
 *
 * Prefers the exact published meter for (category, vCPU) and falls back to the flat
 * per-vCPU rate. The two differ slightly because Microsoft rounds the meters to three
 * decimals - the 8 vCPU meter is $0.342/hr where 8 x $0.0428 is $0.3424 - so the
 * published meter is the more accurate of the two and is preferred.
 */
function licenceForPool(
  prices: PriceTable,
  sku: Sku,
  nodes: number,
  flavour: ClusterPlan['flavour'],
): { hourly: number; source: CostLine['source']; note: string } {
  const product = licenceProductName(sku, flavour);
  const exact = prices.aroLicence[licenceMeterKey(product, sku.vcpu)];

  if (exact !== undefined) {
    return {
      hourly: exact * nodes,
      source: 'azure-api',
      note: `Meter "${product}" / ${sku.vcpu} vCPU at $${exact}/hr per node`,
    };
  }

  const hourly = prices.aroLicencePerVcpu * sku.vcpu * nodes;
  return {
    hourly,
    source: 'azure-api',
    note:
      `No published "${product}" meter for ${sku.vcpu} vCPU; using the flat ` +
      `$${prices.aroLicencePerVcpu}/vCPU/hr ARO rate`,
  };
}

function round(n: number, dp = 4): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/**
 * Price a cluster plan. Pure: every number comes from `prices` or `overrides`, so
 * this is fully deterministic in tests and identical whether it runs in the browser,
 * the backend or the MCP server.
 */
export function estimateCost(
  plan: ClusterPlan,
  prices: PriceTable,
  overrides: Partial<PricingOverrides> = {},
): CostEstimate {
  const opts: PricingOverrides = { ...DEFAULT_OVERRIDES, ...overrides };
  const lines: CostLine[] = [];
  const assumptions: string[] = [];

  // --- Worker compute -------------------------------------------------------
  for (const pool of plan.workerPools) {
    const each = vmHourly(prices, pool.sku);
    lines.push({
      label: `Worker VMs - ${pool.sku.name} x${pool.nodes}`,
      detail: `${pool.totalVcpu} vCPU / ${pool.totalRamGiB} GiB total`,
      hourly: round(each * pool.nodes),
      source: 'azure-api',
      sourceNote: `Linux on-demand at $${each}/hr per VM in ${prices.region}`,
      included: true,
    });
  }

  // --- Control plane --------------------------------------------------------
  if (plan.flavour === 'classic') {
    if (!plan.controlPlaneSku) {
      throw new Error('A classic ARO plan must specify a control plane SKU.');
    }
    const each = vmHourly(prices, plan.controlPlaneSku);
    lines.push({
      label: `Control plane VMs - ${plan.controlPlaneSku.name} x${CONTROL_PLANE_NODES}`,
      hourly: round(each * CONTROL_PLANE_NODES),
      source: 'azure-api',
      sourceNote: `Linux on-demand at $${each}/hr per VM. Control plane nodes are charged as infrastructure but are not licensed.`,
      included: true,
    });
  } else {
    const fee = opts.hcpControlPlanePerHour;
    if (fee === null) {
      lines.push({
        label: 'Hosted control plane fee',
        hourly: 0,
        source: 'assumption',
        sourceNote:
          'Microsoft has not published the ARO HCP per-cluster control-plane fee - ' +
          'it is absent from both the pricing page and the Retail Prices API. ' +
          'Excluded from the total. Set hcpControlPlanePerHour to include it.',
        included: false,
      });
      assumptions.push(
        'The ARO HCP per-cluster control-plane fee is NOT included - Microsoft has not published a rate. ' +
          'The real total will be higher than shown.',
      );
    } else {
      const note = opts.hcpControlPlaneNote;
      lines.push({
        label: 'Hosted control plane fee',
        hourly: round(fee),
        source: 'override',
        sourceNote: note
          ? `ASSUMPTION: ${note}`
          : 'Locally configured rate - Microsoft has not published one for ARO HCP.',
        included: true,
      });
      assumptions.push(
        `ASSUMPTION, NOT A CONFIRMED PRICE: the hosted control plane fee of $${fee}/hr is a ` +
          `locally configured value. Microsoft has not published a rate for ARO HCP. ` +
          (note ? `${note} ` : '') +
          `Do not quote this figure as an Azure price.`,
      );
    }
  }

  // --- ARO licence ----------------------------------------------------------
  // Worker cores only. Control plane nodes are never licensed.
  for (const pool of plan.workerPools) {
    const licence = licenceForPool(prices, pool.sku, pool.nodes, plan.flavour);
    lines.push({
      label: `ARO licence - ${pool.sku.name} x${pool.nodes}`,
      detail: `${pool.totalVcpu} worker vCPU`,
      hourly: round(licence.hourly),
      source: licence.source,
      sourceNote: licence.note,
      included: true,
    });
  }

  // --- Storage --------------------------------------------------------------
  const totalNodes =
    plan.workerPools.reduce((n, p) => n + p.nodes, 0) +
    (plan.flavour === 'classic' ? CONTROL_PLANE_NODES : 0);

  if (opts.osDiskPerGiBMonth === null) {
    lines.push({
      label: 'OS disks',
      detail: `${totalNodes} x ${opts.osDiskGiB} GiB`,
      hourly: 0,
      source: 'assumption',
      sourceNote: 'Managed disk pricing not supplied; excluded from the total.',
      included: false,
    });
    assumptions.push('Managed disk (OS disk) cost is not included.');
  } else {
    const monthly = totalNodes * opts.osDiskGiB * opts.osDiskPerGiBMonth;
    lines.push({
      label: 'OS disks',
      detail: `${totalNodes} x ${opts.osDiskGiB} GiB`,
      hourly: round(monthly / opts.hoursPerMonth),
      source: 'override',
      sourceNote: `$${opts.osDiskPerGiBMonth}/GiB/month`,
      included: true,
    });
  }

  // --- Persistent volume storage -------------------------------------------
  //
  // PVCs, not the node OS disks above. Azure bills a managed disk at its
  // provisioned tier, so a 300 GiB request is billed as a 512 GiB P20 - priced
  // per disk per month, hence the division to get an hourly figure.
  if (plan.storage) {
    const { disk, tier, requestedGiB, wastedGiB } = plan.storage;
    const monthly = prices.disk?.[diskMeterKey(tier, disk.name)];
    const label = `Persistent volume storage - ${disk.name} (${STORAGE_TIER_LABEL[tier]})`;

    if (monthly === undefined) {
      lines.push({
        label,
        detail: `${requestedGiB} GiB requested, ${disk.gib} GiB provisioned`,
        hourly: 0,
        source: 'assumption',
        sourceNote:
          `No published ${STORAGE_TIER_LABEL[tier]} ${disk.name} meter for ` +
          `${prices.region}; excluded from the total.`,
        included: false,
      });
      assumptions.push(
        `Persistent volume storage is not included - no managed disk price was available for ${prices.region}.`,
      );
    } else {
      lines.push({
        label,
        detail: `${requestedGiB} GiB requested, ${disk.gib} GiB provisioned`,
        hourly: round(monthly / opts.hoursPerMonth),
        source: 'azure-api',
        sourceNote: `$${monthly}/month for one ${disk.name} LRS disk in ${prices.region}`,
        included: true,
      });

      if (wastedGiB > 0) {
        assumptions.push(
          `Storage is billed at the provisioned tier, not at what you use: ` +
            `${requestedGiB} GiB lands on a ${disk.gib} GiB ${disk.name}, so ` +
            `${wastedGiB} GiB is paid for and unusable.`,
        );
      }
      assumptions.push(
        'Storage is costed as a single disk holding the whole request. Each PVC ' +
          'is its own managed disk billed at its own tier, so splitting the same ' +
          'capacity across many small volumes costs more than this figure. ' +
          'Per-IO transaction charges are not included.',
      );
    }
  }

  // --- OpenShift Data Foundation -------------------------------------------
  //
  // Three things, all of which people forget when they compare ODF to a cloud
  // storage service: dedicated nodes that run no application workload, the ARO
  // licence on those nodes' cores, and three copies of every byte on managed
  // disks you also pay for.
  if (plan.odf) {
    const odf = plan.odf;
    const each = vmHourly(prices, odf.sku);

    lines.push({
      label: `ODF nodes - ${odf.sku.name} x${odf.nodes}`,
      detail: `${odf.nodes * odf.sku.vcpu} vCPU / ${odf.nodes * odf.sku.ramGiB} GiB, dedicated to storage`,
      hourly: round(each * odf.nodes),
      source: 'azure-api',
      sourceNote:
        `Linux on-demand at $${each}/hr per VM. ODF requires ${ODF_NODES} nodes of at ` +
        `least ${ODF_NODE_VCPU} vCPU / ${ODF_NODE_RAM_GIB} GiB. No application workload ` +
        `runs on them.`,
      included: true,
    });

    const odfLicence = licenceForPool(prices, odf.sku, odf.nodes, plan.flavour);
    lines.push({
      label: `ARO licence - ODF nodes x${odf.nodes}`,
      detail: `${odf.nodes * odf.sku.vcpu} vCPU`,
      hourly: round(odfLicence.hourly),
      source: odfLicence.source,
      sourceNote: `${odfLicence.note}. ODF nodes are workers and are licensed as such.`,
      included: true,
    });

    assumptions.push(
      `ODF adds ${odf.nodes} dedicated storage nodes that carry no application ` +
        `workload, and their cores are licensed. Azure Blob and managed disks are ` +
        `services with no nodes to run.`,
    );

    // The replicated capacity, costed on the same disk ladder as a PVC.
    if (odf.rawGiB > 0) {
      const tier = plan.storage?.tier ?? 'premium-ssd';
      const backing = diskFor(odf.rawGiB, tier);
      const monthly = backing ? prices.disk?.[diskMeterKey(tier, backing.name)] : undefined;

      if (backing === null || monthly === undefined) {
        lines.push({
          label: 'ODF backing disks',
          detail: `${odf.usableGiB} GiB usable, ${odf.rawGiB} GiB raw at ${odf.replication}x replication`,
          hourly: 0,
          source: 'assumption',
          sourceNote:
            `No published ${STORAGE_TIER_LABEL[tier]} meter covering ${odf.rawGiB} GiB in ` +
            `${prices.region}; excluded from the total.`,
          included: false,
        });
        assumptions.push(
          'ODF backing disk cost is not included - no managed disk price covered the replicated capacity.',
        );
      } else {
        lines.push({
          label: `ODF backing disks - ${backing.name} (${STORAGE_TIER_LABEL[tier]})`,
          detail: `${odf.usableGiB} GiB usable, ${odf.rawGiB} GiB raw at ${odf.replication}x replication`,
          hourly: round(monthly / opts.hoursPerMonth),
          source: 'azure-api',
          sourceNote:
            `$${monthly}/month for one ${backing.name} LRS disk in ${prices.region}. ` +
            `Ceph stores ${odf.replication} copies, so ${odf.usableGiB} GiB usable costs ` +
            `${odf.rawGiB} GiB of provisioned disk.`,
          included: true,
        });
        assumptions.push(
          `ODF capacity is replicated ${odf.replication}x: you provision and pay for ` +
            `${odf.rawGiB} GiB to offer ${odf.usableGiB} GiB. The figure assumes one disk ` +
            `holding the whole raw capacity; a real deployment spreads it over several ` +
            `devices per node, which costs more.`,
        );
      }
    }
  }

  // --- Object storage -------------------------------------------------------
  //
  // Blob is costed whichever backend was chosen. When ODF is serving the
  // buckets the Blob figure is still shown, excluded, because the gap between
  // the two is the entire reason both are offered.
  if (plan.objectStorage) {
    const obj = plan.objectStorage;
    const servedByOdf = obj.backend === 'odf';

    if (obj.blobMonthly === null) {
      lines.push({
        label: 'Object storage - Azure Blob (Hot LRS)',
        detail: `${obj.gib} GiB`,
        hourly: 0,
        source: 'assumption',
        sourceNote: `No published Blob meter for ${prices.region}; excluded from the total.`,
        included: false,
      });
      assumptions.push(
        `Object storage is not included - no Azure Blob price was available for ${prices.region}.`,
      );
    } else {
      const rate = obj.blobMarginalRate;
      lines.push({
        label: servedByOdf
          ? 'Object storage - the same capacity on Azure Blob'
          : 'Object storage - Azure Blob (Hot LRS)',
        detail: `${obj.gib} GiB${servedByOdf ? ', NOT selected - served by ODF above' : ''}`,
        hourly: round(obj.blobMonthly / opts.hoursPerMonth),
        source: 'azure-api',
        sourceNote:
          `${BLOB_PRODUCT} / ${BLOB_SKU} at $${rate}/GB/month in ${prices.region}, ` +
          `applied across the published bands. Billed on what is stored, with nothing ` +
          `to provision.` +
          (servedByOdf
            ? ' Shown for comparison only and excluded from the total.'
            : ''),
        included: !servedByOdf,
      });

      if (servedByOdf) {
        assumptions.push(
          `The same ${obj.gib} GiB of object storage would cost ` +
            `$${(obj.blobMonthly).toFixed(2)}/month on Azure Blob, against the ODF nodes ` +
            `and replicated disks above. Compare the two before committing to ODF.`,
        );
      }
    }
  }

  // --- Always-excluded ------------------------------------------------------
  lines.push({
    label: 'Network egress and load balancers',
    hourly: 0,
    source: 'assumption',
    sourceNote: 'Depends entirely on traffic; not estimated.',
    included: false,
  });
  assumptions.push(
    'Outbound data transfer, load balancer and public IP charges are not included.',
  );

  if (prices.stale) {
    assumptions.push(
      `Prices are from a cached snapshot taken at ${prices.retrievedAt} because the Azure Retail Prices API was unreachable.`,
    );
  }

  const hourly = round(
    lines.filter(l => l.included).reduce((sum, l) => sum + l.hourly, 0),
  );

  return {
    currency: prices.currency,
    region: prices.region,
    lines,
    hourly,
    monthly: round(hourly * opts.hoursPerMonth, 2),
    yearly: round(hourly * opts.hoursPerMonth * 12, 2),
    hoursPerMonth: opts.hoursPerMonth,
    assumptions,
  };
}
