import type { CostEstimate, SizingRequest } from '@aro-planner/common';

/** The shape the backend's POST /plan returns. */
export interface ModelComparisonDto {
  model: 'shared-namespace' | 'dedicated-cluster' | 'on-premises';
  label: string;
  billing: 'monthly' | 'one-off';
  amount: number | null;
  estimate: CostEstimate | null;
  summary: string;
  unpricedReason?: string;
  tradeoffs: string[];
}

export interface EndpointInput {
  name: string;
  direction: 'ingress' | 'egress';
  target:
    | { kind: 'internet' }
    | { kind: 'namespace'; namespace?: string }
    | { kind: 'on-premises'; cidrs?: string[] }
    | { kind: 'azure-service'; service?: string };
  ports?: { protocol: 'TCP' | 'UDP'; port: number }[];
}

export interface NetworkPlanDto {
  namespace: string;
  policies: { metadata: { name: string }; spec: unknown }[];
  caveats: string[];
  clusterSettings: {
    apiVisibility: string;
    ingressVisibility: string;
    outboundType: string;
  };
}

export interface PlanResponse {
  request: SizingRequest;
  recommendations: Recommendation[];
  estimate: CostEstimate | null;
  comparison: ModelComparisonDto[];
  cheapest: string | null;
  networkPlan: NetworkPlanDto | null;
  warning?: string;
  pricesRetrievedAt: string;
  pricesStale: boolean;
}

export interface Recommendation {
  sku: { name: string; vcpu: number; ramGiB: number; category: string; day2Only: boolean };
  nodes: number;
  totalVcpu: number;
  totalRamGiB: number;
  allocatableVcpu: number;
  allocatableRamGiB: number;
  waste: number;
  rationale: string[];
  hourlyVmCost?: number;
}

export interface PlanInput {
  vcpu: number;
  ramGiB: number;
  region: string;
  flavour: 'hcp' | 'classic';
  profile?: string | undefined;
  highAvailability: boolean;
  dayTwo: boolean;
  /** Which deployment model the user has chosen. */
  deploymentModel: 'shared-namespace' | 'dedicated-cluster' | 'on-premises';
  /** The application this request is for. */
  applicationName?: string;
  /** What the application needs to talk to. Becomes NetworkPolicies. */
  endpoints?: EndpointInput[];
  controlPlaneSku?: string;
  openshiftVersion?: string;
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
