import type {
  CostEstimate,
  DeploymentModel,
  EndpointRequest,
  ModelComparison,
  NetworkPlan,
  Recommendation,
  SizingRequest,
} from '@aro-planner/common';

/**
 * Types for the backend's `POST /plan`.
 *
 * These re-export the engine's own types rather than restating them. Local copies
 * drifted from the originals once already - the UI carried a `ModelComparison`
 * missing `billing`, so an on-premises one-off rendered as "/month". The backend
 * serialises these exact shapes, so there is nothing for a parallel definition to
 * add except an opportunity to disagree.
 */
export type { CostEstimate, DeploymentModel, ModelComparison, NetworkPlan, Recommendation };

/**
 * An endpoint while the user is still typing it.
 *
 * Deliberately looser than the engine's `EndpointRequest`: a row is in the form
 * before it is complete, so `namespace`, `cidrs` and `service` are optional here
 * and required there. The backend validates with zod and rejects the incomplete
 * ones, which is why this is a separate type rather than drift.
 */
export interface EndpointInput {
  name: string;
  direction: EndpointRequest['direction'];
  target:
    | { kind: 'internet' }
    | { kind: 'namespace'; namespace?: string }
    | { kind: 'on-premises'; cidrs?: string[] }
    | { kind: 'azure-service'; service?: string };
  ports?: { protocol: 'TCP' | 'UDP'; port: number }[];
}

export interface PlanResponse {
  request: SizingRequest;
  recommendations: Recommendation[];
  /** The pool the costing actually used - the selected one, or the cheapest. */
  selectedSku?: string;
  estimate: CostEstimate | null;
  comparison: ModelComparison[];
  cheapest: DeploymentModel | null;
  networkPlan: NetworkPlan | null;
  warning?: string;
  pricesRetrievedAt: string;
  pricesStale: boolean;
}

/**
 * What the wizard sends.
 *
 * A subset of `SizingRequest` - `profile` may be absent, because the backend
 * infers it from the RAM:vCPU ratio - plus the endpoints, which the engine takes
 * separately.
 */
export interface PlanInput
  extends Omit<SizingRequest, 'profile' | 'deploymentModel' | 'openshiftVersion'> {
  profile?: string | undefined;
  deploymentModel: DeploymentModel;
  /** What the application needs to talk to. Becomes NetworkPolicies. */
  endpoints?: EndpointInput[];
  controlPlaneSku?: string;
  openshiftVersion?: string;
  /** A node pool the user picked. Absent means the cheapest is used. */
  nodePoolSku?: string;
}

/**
 * Post a plan request to the backend plugin.
 *
 * `baseUrl` comes from Backstage's discovery API and `fetchFn` from its fetch API,
 * so the request carries the user's credentials and resolves correctly whether the
 * backend is mounted in RHDH or running standalone. Hard-coding a relative path
 * would 401 against an authenticated backend plugin.
 */
export async function fetchPlan(
  baseUrl: string,
  fetchFn: typeof fetch,
  input: PlanInput,
  signal?: AbortSignal,
): Promise<PlanResponse> {
  const res = await fetchFn(`${baseUrl}/plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    ...(signal ? { signal } : {}),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(
      body.error ?? `Pricing request failed: ${res.status} ${res.statusText}`,
    );
  }
  return (await res.json()) as PlanResponse;
}

export interface EmitFile {
  path: string;
  contents: string;
}

export interface EmitBundle {
  name: string;
  files: EmitFile[];
}

/**
 * The files this request would produce.
 *
 * A separate call from `fetchPlan` because it is only wanted when someone opens
 * the review dialog, and generating it on every keystroke alongside the cost
 * panel would be wasted work.
 */
export async function fetchArtifacts(
  baseUrl: string,
  fetchFn: typeof fetch,
  input: PlanInput,
  signal?: AbortSignal,
): Promise<EmitBundle> {
  const res = await fetchFn(`${baseUrl}/artifacts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    ...(signal ? { signal } : {}),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Could not generate the artifacts: ${res.status}`);
  }
  return (await res.json()) as EmitBundle;
}
