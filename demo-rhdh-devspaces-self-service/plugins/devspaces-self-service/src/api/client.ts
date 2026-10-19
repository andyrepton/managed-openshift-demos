/**
 * Types and calls for the backend's three endpoints.
 *
 * The shapes mirror the backend's own rather than restating them loosely.
 * The planner next door learned this the hard way: a local copy of a type
 * drifted from the original and a field went missing in the UI with nothing
 * to catch it.
 */

export interface AgentCapability {
  id: string;
  displayName: string;
  description: string;
  vsixPath?: string;
  binary?: string;
  version: string;
  editorOnly: boolean;
}

export interface Capabilities {
  image?: string;
  agents: AgentCapability[];
  cheUrl?: string;
  inClusterAi?: { baseUrl: string; available: boolean; reason?: string };
  problems: string[];
}

export type StorageMode = 'persistent' | 'ephemeral';
export type AiBackendKind = 'none' | 'in-cluster' | 'third-party';

export interface DevSpaceRequestInput {
  workspaceCount: number;
  totalVcpu: number;
  totalRamGiB: number;
  storageGiB: number;
  storageMode: StorageMode;
  agents: string[];
  ai: { kind: AiBackendKind; baseUrl?: string; apiKey?: string; model?: string };
  repoUrl?: string;
}

export interface WorkspaceSize {
  cpuLimitMilli: number;
  cpuRequestMilli: number;
  ramLimitMiB: number;
  ramRequestMiB: number;
}

export interface QuotaSize {
  requestsCpuMilli: number;
  requestsRamMiB: number;
  limitsCpuMilli: number;
  limitsRamMiB: number;
  pods: number;
  persistentVolumeClaims: number;
  requestsStorageGiB: number;
}

export interface GeneratedFile {
  path: string;
  contents: string;
  purpose: string;
  applied: boolean;
}

export interface PlanResponse {
  namespace: string;
  sizing: { perWorkspace: WorkspaceSize; quota: QuotaSize; warnings: string[] };
  files: GeneratedFile[];
  warnings: string[];
  factoryUrl?: string;
}

export interface ProvisionResult {
  namespace: string;
  applied: { kind: string; name: string; created: boolean }[];
}

async function fail(res: Response, fallback: string): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  throw new Error(body.error ?? `${fallback}: ${res.status} ${res.statusText}`);
}

export async function fetchCapabilities(
  baseUrl: string,
  fetchFn: typeof fetch,
  signal?: AbortSignal,
): Promise<Capabilities> {
  const res = await fetchFn(`${baseUrl}/capabilities`, { ...(signal ? { signal } : {}) });
  if (!res.ok) return fail(res, 'Could not read what this cluster offers');
  return (await res.json()) as Capabilities;
}

export async function fetchPlan(
  baseUrl: string,
  fetchFn: typeof fetch,
  input: DevSpaceRequestInput,
  signal?: AbortSignal,
): Promise<PlanResponse> {
  const res = await fetchFn(`${baseUrl}/plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    ...(signal ? { signal } : {}),
  });
  if (!res.ok) return fail(res, 'Could not plan that request');
  return (await res.json()) as PlanResponse;
}

/**
 * The one call that writes.
 *
 * Deliberately not debounced or retried. A request that creates a namespace
 * should happen exactly when somebody presses the button, once.
 */
export async function provision(
  baseUrl: string,
  fetchFn: typeof fetch,
  input: DevSpaceRequestInput,
): Promise<ProvisionResult> {
  const res = await fetchFn(`${baseUrl}/provision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) return fail(res, 'Could not create the Dev Space');
  return (await res.json()) as ProvisionResult;
}
