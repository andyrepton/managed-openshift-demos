import type {
  ClusterPlan,
  ModelComparison,
  NodePoolPlan,
  SizingRequest,
} from '../types.js';
import type { NetworkPlan } from '../netpol.js';

/** One generated file, ready to write to disk or to put in a pull request. */
export interface EmitFile {
  /** Repo-relative path, e.g. `requested/payments-api/manifests/00-namespace.yaml`. */
  path: string;
  contents: string;
}

export interface EmitBundle {
  /** DNS-label name derived from the application name; also the namespace. */
  name: string;
  files: EmitFile[];
}

/**
 * Everything the emitters need, already resolved.
 *
 * Deliberately takes finished objects rather than doing any sizing or pricing of
 * its own. The wizard, the backend and the Scaffolder all emit from the same
 * computed plan, so an artifact can never disagree with the page that produced it.
 */
export interface EmitInput {
  request: SizingRequest;
  /** The costed cluster. Null when no ARO cluster is being created. */
  plan: ClusterPlan | null;
  /** The chosen worker pool. Null for shared-namespace and on-premises. */
  pool: NodePoolPlan | null;
  /** Runners-up, recorded in the plan document so the choice is auditable. */
  alternatives?: NodePoolPlan[];
  comparison: ModelComparison[];
  networkPlan: NetworkPlan;
  /** Provenance for the figures: when Azure was last reached, and whether cached. */
  prices?: { retrievedAt: string; stale?: boolean };
  /** Overridden in tests so golden files do not churn on every run. */
  generatedAt?: string;
  /** Owner written into `catalog-info.yaml`. */
  owner?: string;
}
