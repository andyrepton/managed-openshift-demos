/**
 * OpenShift Data Foundation: what it costs to run storage yourself.
 *
 * ODF is in the planner to be compared against, not to be recommended. On a
 * managed cluster in a cloud that already sells storage, running Ceph means
 * buying three dedicated nodes and three copies of every byte, and the planner
 * exists to put that number next to the Azure one.
 *
 * There are real reasons to choose it - RWX volumes, an S3 API inside the
 * cluster, portability across clouds, data that must not leave the cluster
 * boundary. The warning says "investigate the alternative", not "never do
 * this".
 *
 * Everything here is a documented Red Hat minimum, not a measurement.
 */

import type { PriceTable, SizingRequest, Sku } from './types.js';
import { findSkus } from './skus.js';

/**
 * Is ODF in play at all?
 *
 * True if it is serving either kind of storage. One question with one answer,
 * because the consequences - three nodes, a dedicated cluster, no Blob - follow
 * from ODF being present, not from which capacity it happens to be serving.
 */
export function odfSelected(req: Pick<SizingRequest, 'blockBackend' | 'objectBackend'>): boolean {
  return req.blockBackend === 'odf' || req.objectBackend === 'odf';
}

/**
 * Three nodes, because ODF places its base services across three failure
 * domains and cannot run on fewer.
 */
export const ODF_NODES = 3;

/**
 * 16 vCPU and 64 GiB each, from the ODF "Planning your deployment" guide,
 * chapter 7: internal mode on a three-node cluster requires 3 x 16 = 48 CPU
 * and 3 x 64 = 192 GB.
 */
export const ODF_NODE_VCPU = 16;
export const ODF_NODE_RAM_GIB = 64;

/**
 * Ceph's default replica count. Three copies of everything, so usable capacity
 * is a third of what you provision and pay for.
 */
export const ODF_REPLICATION = 3;

/** The package in OperatorHub, for the live availability check. */
export const ODF_PACKAGE = 'odf-operator';

export const ODF_DOC_URL =
  'https://docs.redhat.com/en/documentation/red_hat_openshift_data_foundation/4.20/html/planning_your_deployment/infrastructure-requirements_rhodf';

/**
 * ODF nodes are dedicated, and that is the point of the cost.
 *
 * They carry the `cluster.ocs.openshift.io/openshift-storage` label and run
 * storage, not the team's workload. They are NOT folded into the worker sizing
 * the way an operator's pods are - a separate pool, charged on top, because
 * nothing the application asked for can be scheduled on them.
 */
export interface OdfPlan {
  nodes: number;
  sku: Sku;
  /** Usable capacity the team asked for. */
  usableGiB: number;
  /** What must actually be provisioned, after replication. */
  rawGiB: number;
  replication: number;
  /** True when ODF is also serving object storage, displacing Blob. */
  servesObject: boolean;
  /** True when ODF is serving block storage, displacing managed disks. */
  servesBlock: boolean;
}

/** Raw capacity needed to offer `usableGiB` at ODF's replication factor. */
export function odfRawGiB(usableGiB: number): number {
  if (!Number.isFinite(usableGiB) || usableGiB <= 0) return 0;
  return usableGiB * ODF_REPLICATION;
}

/**
 * The cheapest supported SKU meeting ODF's per-node minimum.
 *
 * Ranked on price when a table is available, the same rule the worker
 * recommender uses, so the ODF pool is not quietly costed on a SKU nobody
 * would pick. Day-2-only sizes are excluded: ODF nodes exist from the start.
 */
export function odfNodeSku(prices?: PriceTable): Sku | null {
  const candidates = findSkus({ role: 'worker', allowDay2Only: false }).filter(
    s => s.vcpu >= ODF_NODE_VCPU && s.ramGiB >= ODF_NODE_RAM_GIB,
  );
  if (candidates.length === 0) return null;

  const priced = prices
    ? candidates.filter(s => prices.vm[s.name] !== undefined)
    : candidates;
  if (priced.length === 0) return null;

  return [...priced].sort((a, b) => {
    if (prices) {
      const pa = prices.vm[a.name]!;
      const pb = prices.vm[b.name]!;
      if (pa !== pb) return pa - pb;
    }
    // Smallest node that still clears the minimum, then a stable name order.
    if (a.vcpu !== b.vcpu) return a.vcpu - b.vcpu;
    if (a.ramGiB !== b.ramGiB) return a.ramGiB - b.ramGiB;
    return a.name.localeCompare(b.name);
  })[0]!;
}

/**
 * Why a shared namespace cannot host this.
 *
 * ODF is a cluster-scoped operator that labels nodes, claims raw devices and
 * runs privileged daemons. None of that is available to a tenant in someone
 * else's cluster, so selecting it is not a preference about where to run - it
 * removes an option.
 */
export const ODF_FORCES_DEDICATED_REASON =
  'OpenShift Data Foundation needs dedicated labelled nodes, raw block devices ' +
  'and cluster-scoped privileges. A tenant namespace on a shared cluster cannot ' +
  'provide any of them.';

export const ODF_WARNING_TITLE = 'Consider Azure Blob storage before choosing ODF';

export const ODF_WARNING_BODY =
  'ODF runs Ceph inside your cluster. That means three dedicated nodes that ' +
  'carry no application workload, and three replicas of every byte stored on ' +
  'managed disks you also pay for. Azure already sells durable, replicated ' +
  'storage as a service, metered per GB with nothing to provision and no nodes ' +
  'to run - for the same capacity it is routinely an order of magnitude cheaper. ' +
  'Choose ODF when you need what it uniquely offers: ReadWriteMany volumes, an ' +
  'S3-compatible endpoint inside the cluster, the same storage layer across ' +
  'clouds, or data that must not leave the cluster boundary. Choosing it to ' +
  'avoid using a cloud storage service is how teams end up paying far more for ' +
  'less durability.';
