import type { CostEstimate, SizingRequest } from '@aro-planner/common';

/**
 * The shape the backend's POST /plan returns.
 *
 * `recommendations` is the Recommendation[] from @aro-planner/common with the SKU
 * inlined, so the UI never has to look anything up itself.
 */
export interface PlanResponse {
  request: SizingRequest;
  recommendations: Recommendation[];
  estimate: CostEstimate | null;
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
  profile?: string;
  highAvailability: boolean;
  dayTwo: boolean;
  controlPlaneSku?: string;
  openshiftVersion?: string;
}

/**
 * Relative URL on purpose: in dev Vite proxies it, and inside Backstage the plugin
 * is served from the same origin. Nothing here needs to know where it is running.
 */
const BASE = '/api/aro-planner';

export async function fetchPlan(input: PlanInput, signal?: AbortSignal): Promise<PlanResponse> {
  const res = await fetch(`${BASE}/plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    ...(signal ? { signal } : {}),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
    throw new Error(body.error ?? `Request failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as PlanResponse;
}
