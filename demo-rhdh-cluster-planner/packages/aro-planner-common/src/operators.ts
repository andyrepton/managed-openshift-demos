/**
 * Operators a team may request alongside its workload.
 *
 * Two things make this more than a checkbox list.
 *
 * First, every entry names a real package in the cluster's OperatorHub. The
 * `packageName` and `catalog` fields were checked against `oc get
 * packagemanifests` on a ROSA 4.x cluster with the stock catalog sources, so a
 * plan cannot ask for something nobody can install. They are static rather than
 * queried live because the planner backend has no cluster credentials - it
 * prices Azure, it does not talk to Kubernetes. Re-check them with
 * `scripts/check-operator-catalog.sh` when the catalogs move.
 *
 * Second, selecting one changes the sizing. An operator is not free: it is the
 * controller pod plus whatever it runs, and for Kafka that is most of a node.
 * The figures below are the *operator and one default instance of what it
 * manages*, because a controller pod on its own is a rounding error and sizing
 * a cluster for it would be theatre.
 *
 * The numbers are documented vendor figures where one exists, marked as
 * assumptions where none does. None of them are measurements, and a real
 * deployment should replace them with its own.
 */

import type { SizingRequest } from './types.js';
import {
  ODF_NODES,
  ODF_NODE_RAM_GIB,
  ODF_NODE_VCPU,
  ODF_PACKAGE,
  ODF_REPLICATION,
} from './odf.js';

export type OperatorId = 'rhbk' | 'amq-streams' | 'flink' | 'odf';

/** Which catalog source ships the package, which is also its support story. */
export type OperatorCatalog = 'redhat-operators' | 'certified-operators' | 'community-operators';

export interface OperatorOption {
  id: OperatorId;
  label: string;
  /** `metadata.name` of the PackageManifest, e.g. what `oc get packagemanifest` shows. */
  packageName: string;
  catalog: OperatorCatalog;
  /** False for community operators: installable, but carrying no Red Hat support. */
  supported: boolean;
  /** Allocatable vCPU for the controller and one default instance. */
  vcpu: number;
  /** Allocatable RAM in GiB for the same. */
  ramGiB: number;
  /** What those totals are made of, pod by pod. */
  breakdown: string;
  /** Where the figures came from, or that they are assumed. */
  sourceNote: string;
  /**
   * True when this operator's capacity is NOT worker pods.
   *
   * ODF is the case: it runs on its own dedicated nodes, costed as a separate
   * pool in `cost.ts`. Adding its capacity to the worker sizing as well would
   * bill the same hardware twice, so `operatorFootprint` leaves it out of the
   * totals while still listing it. `vcpu` and `ramGiB` stay zero to make a
   * mistake here impossible rather than merely unlikely.
   */
  costedSeparately?: boolean;
  /** Dedicated nodes this operator requires, when it has any. */
  dedicatedNodes?: number;
  /**
   * Selected by choosing it elsewhere in the form rather than by its checkbox.
   *
   * ODF is picked as a storage backend; the operator entry reflects that
   * choice so the catalog check and the plan document both see it.
   */
  derivedFromStorage?: boolean;
}

/**
 * The approved list.
 *
 * Deliberately short. This is the set a platform team has agreed to run, not
 * everything in OperatorHub - 630 packages are installable on the demo cluster
 * and offering all of them would make the choice meaningless.
 */
export const OPERATOR_CATALOG: OperatorOption[] = [
  {
    id: 'rhbk',
    label: 'Red Hat build of Keycloak',
    packageName: 'rhbk-operator',
    catalog: 'redhat-operators',
    supported: true,
    vcpu: 6.1,
    ramGiB: 4.0,
    breakdown: '3 Keycloak pods at 2 vCPU / 1250 MB each, plus the operator pod.',
    sourceNote:
      'Per-pod figures are the example CR in the Red Hat build of Keycloak High ' +
      'Availability Guide, "Concepts for sizing CPU and memory resources". That ' +
      'guide sizes CPU by login rate, so a quiet realm needs far less. The ' +
      'operator pod itself is assumed at 0.1 vCPU / 0.5 GiB.',
  },
  {
    id: 'amq-streams',
    label: 'Streams for Apache Kafka (AMQ Streams)',
    packageName: 'amq-streams',
    catalog: 'redhat-operators',
    supported: true,
    vcpu: 4.7,
    ramGiB: 9.4,
    breakdown:
      '3 brokers at 1 vCPU / 2 GiB, 3 KRaft controllers at 0.5 vCPU / 1 GiB, ' +
      'plus the cluster operator at 200m / 384 MiB.',
    sourceNote:
      'Broker and controller figures are Red Hat solution 4205851, the minimum ' +
      'sizing guide for an OpenShift DEVELOPMENT environment - Red Hat states ' +
      'they are not suitable for production. Streams for Apache Kafka sets no ' +
      'default requests or limits on its operands at all, so there is no ' +
      'vendor production default to quote.',
  },
  {
    id: 'flink',
    label: 'Apache Flink (community)',
    packageName: 'flink-kubernetes-operator',
    catalog: 'community-operators',
    supported: false,
    vcpu: 2.25,
    ramGiB: 4.5,
    breakdown: '1 JobManager and 1 TaskManager at 1 vCPU / 2 GiB each, plus the operator pod.',
    sourceNote:
      'JobManager and TaskManager figures are the upstream `examples/basic.yaml` ' +
      'in apache/flink-kubernetes-operator. A real job sets its own parallelism ' +
      'and needs more TaskManagers. The operator pod is assumed at 0.25 vCPU / ' +
      '0.5 GiB.',
  },
  {
    id: 'odf',
    label: 'OpenShift Data Foundation',
    packageName: ODF_PACKAGE,
    catalog: 'redhat-operators',
    supported: true,
    // Zero on purpose. ODF's capacity is three dedicated nodes, costed as
    // their own pool. Putting a figure here would add it to the worker sizing
    // as well and charge for the same hardware twice.
    vcpu: 0,
    ramGiB: 0,
    costedSeparately: true,
    dedicatedNodes: ODF_NODES,
    derivedFromStorage: true,
    breakdown:
      `${ODF_NODES} dedicated nodes of at least ${ODF_NODE_VCPU} vCPU / ` +
      `${ODF_NODE_RAM_GIB} GiB, plus ${ODF_REPLICATION}x replicated disks, costed ` +
      'as their own pool rather than added to the worker sizing.',
    sourceNote:
      'Node minimums are the ODF "Planning your deployment" guide, chapter 7. ' +
      'Selected by choosing ODF as a storage backend, not by this checkbox - ' +
      'see the Storage section.',
  },
];

export const OPERATOR_IDS: OperatorId[] = OPERATOR_CATALOG.map(o => o.id);

export function isOperatorId(value: unknown): value is OperatorId {
  return typeof value === 'string' && OPERATOR_IDS.includes(value as OperatorId);
}

export function operatorById(id: OperatorId): OperatorOption | undefined {
  return OPERATOR_CATALOG.find(o => o.id === id);
}

export interface OperatorFootprint {
  /** Total allocatable vCPU the selection adds. */
  vcpu: number;
  /** Total allocatable RAM in GiB the selection adds. */
  ramGiB: number;
  /** The selected entries, in catalog order, unknown ids dropped. */
  items: OperatorOption[];
  /** True when any selected operator is unsupported by Red Hat. */
  hasUnsupported: boolean;
}

/**
 * What a selection of operators adds to a capacity request.
 *
 * Unknown ids are ignored rather than throwing: an id dropped from the catalog
 * should cost a line in the plan, not fail the whole estimate. Duplicates are
 * counted once, because the UI sends a set and an operator installed twice is
 * still installed once.
 */
export function operatorFootprint(ids: readonly OperatorId[] | undefined): OperatorFootprint {
  const selected = new Set(ids ?? []);
  const items = OPERATOR_CATALOG.filter(o => selected.has(o.id));

  // Fixed to 2dp: the catalog carries figures like 2.25 and 0.375, and summing
  // them in binary floating point otherwise surfaces 10.949999999999999 in the UI.
  const round = (n: number) => Math.round(n * 100) / 100;

  // Only operators that run as worker pods add to the worker sizing. ODF runs
  // on dedicated nodes priced as their own pool, so counting it here too would
  // bill the same hardware twice.
  const inWorkerPools = items.filter(o => !o.costedSeparately);

  return {
    vcpu: round(inWorkerPools.reduce((sum, o) => sum + o.vcpu, 0)),
    ramGiB: round(inWorkerPools.reduce((sum, o) => sum + o.ramGiB, 0)),
    items,
    hasUnsupported: items.some(o => !o.supported),
  };
}

/**
 * Fold the operator footprint into the capacity being sized for.
 *
 * Every caller that sizes a cluster goes through this, so the wizard, the MCP
 * tools and the CLI cannot disagree about whether Kafka was counted. The
 * request keeps its `operators` list afterwards, so downstream code can still
 * explain where the extra capacity went.
 */
export function withOperatorCapacity(req: SizingRequest): SizingRequest {
  const footprint = operatorFootprint(req.operators);
  if (footprint.items.length === 0) return req;
  return {
    ...req,
    vcpu: Math.round((req.vcpu + footprint.vcpu) * 100) / 100,
    ramGiB: Math.round((req.ramGiB + footprint.ramGiB) * 100) / 100,
  };
}
