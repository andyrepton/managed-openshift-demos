/**
 * Turning a request into per-workspace limits and a namespace quota.
 *
 * The user says "I want N workspaces and this much capacity in total". Three
 * things have to come out of that, and getting any of them wrong fails in a
 * way that is hard to diagnose from inside a workspace:
 *
 *   1. Per-workspace CPU/memory, which goes in the devfile.
 *   2. A ResourceQuota, which is what actually stops the namespace growing.
 *   3. A LimitRange, so a pod created without resources - by the user, by
 *      hand, by anything - still gets sane defaults instead of being
 *      unbounded or rejected.
 *
 * The number that catches people out is the editor. che-code is injected into
 * the workspace pod as an init container and then runs inside the dev
 * container, so its memory comes out of the same limit the user set. A
 * workspace sized at exactly what the application needs leaves the editor
 * nothing, and the symptom is Code - OSS failing to start with no useful
 * message.
 */

/** Minimum a workspace needs to run che-code at all, before any workload. */
export const EDITOR_CPU_MILLI = 500;
export const EDITOR_RAM_MIB = 1024;

/**
 * Floor for a usable workspace. Below this che-code either fails to start or
 * is too slow to be worth demonstrating.
 */
export const MIN_WORKSPACE_CPU_MILLI = 500;
export const MIN_WORKSPACE_RAM_MIB = 2048;

export const MAX_WORKSPACES = 20;

/**
 * Requests are a fraction of limits, deliberately.
 *
 * A workspace is idle most of the time - someone is reading, not compiling -
 * so reserving the ceiling wastes most of the cluster. The quota counts
 * requests for scheduling and limits for the ceiling, which is what lets a
 * handful of workspaces share a node and still burst.
 */
export const REQUEST_FRACTION = 0.5;

export type StorageMode = 'persistent' | 'ephemeral';

export interface SizingInput {
  /** How many workspaces this developer wants to be able to run. */
  workspaceCount: number;
  /** Total vCPU across all of them. */
  totalVcpu: number;
  /** Total RAM in GiB across all of them. */
  totalRamGiB: number;
  /** Per-workspace persistent volume size in GiB. Ignored when ephemeral. */
  storageGiB: number;
  storageMode: StorageMode;
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
  /** Pods, not workspaces: a stopped workspace has none, a running one has one. */
  pods: number;
  persistentVolumeClaims: number;
  requestsStorageGiB: number;
}

export interface Sizing {
  input: SizingInput;
  perWorkspace: WorkspaceSize;
  quota: QuotaSize;
  /** Things the user should know, in the order they matter. */
  warnings: string[];
}

export class SizingError extends Error {}

const mib = (gib: number) => Math.round(gib * 1024);

/**
 * One PVC per workspace, or none at all.
 *
 * This cluster's CheCluster uses `pvcStrategy: per-user`, so in practice every
 * workspace for one user shares a single PVC. The quota is written for the
 * per-workspace worst case anyway: a quota that is too tight breaks workspace
 * startup with an obscure message, and the cost of being generous here is a
 * limit nobody hits.
 */
function storageFor(input: SizingInput): { pvcs: number; gib: number } {
  if (input.storageMode === 'ephemeral') return { pvcs: 0, gib: 0 };
  return { pvcs: input.workspaceCount, gib: input.storageGiB * input.workspaceCount };
}

export function computeSizing(input: SizingInput): Sizing {
  const { workspaceCount, totalVcpu, totalRamGiB } = input;

  if (!Number.isInteger(workspaceCount) || workspaceCount < 1) {
    throw new SizingError('workspaceCount must be a whole number of at least 1');
  }
  if (workspaceCount > MAX_WORKSPACES) {
    throw new SizingError(`workspaceCount must be ${MAX_WORKSPACES} or fewer`);
  }
  if (!(totalVcpu > 0) || !(totalRamGiB > 0)) {
    throw new SizingError('totalVcpu and totalRamGiB must both be greater than zero');
  }
  if (input.storageMode === 'persistent' && !(input.storageGiB > 0)) {
    throw new SizingError('storageGiB must be greater than zero for persistent storage');
  }

  const cpuLimitMilli = Math.floor((totalVcpu * 1000) / workspaceCount);
  const ramLimitMiB = Math.floor(mib(totalRamGiB) / workspaceCount);

  if (cpuLimitMilli < MIN_WORKSPACE_CPU_MILLI) {
    throw new SizingError(
      `${totalVcpu} vCPU across ${workspaceCount} workspaces is ${cpuLimitMilli}m each, ` +
        `below the ${MIN_WORKSPACE_CPU_MILLI}m a workspace needs to run the editor. ` +
        'Ask for more vCPU or fewer workspaces.',
    );
  }
  if (ramLimitMiB < MIN_WORKSPACE_RAM_MIB) {
    throw new SizingError(
      `${totalRamGiB} GiB across ${workspaceCount} workspaces is ${ramLimitMiB}Mi each, ` +
        `below the ${MIN_WORKSPACE_RAM_MIB}Mi a workspace needs to run the editor. ` +
        'Ask for more memory or fewer workspaces.',
    );
  }

  const perWorkspace: WorkspaceSize = {
    cpuLimitMilli,
    ramLimitMiB,
    cpuRequestMilli: Math.max(
      MIN_WORKSPACE_CPU_MILLI,
      Math.floor(cpuLimitMilli * REQUEST_FRACTION),
    ),
    ramRequestMiB: Math.max(MIN_WORKSPACE_RAM_MIB, Math.floor(ramLimitMiB * REQUEST_FRACTION)),
  };

  const storage = storageFor(input);

  const quota: QuotaSize = {
    requestsCpuMilli: perWorkspace.cpuRequestMilli * workspaceCount,
    requestsRamMiB: perWorkspace.ramRequestMiB * workspaceCount,
    limitsCpuMilli: perWorkspace.cpuLimitMilli * workspaceCount,
    limitsRamMiB: perWorkspace.ramLimitMiB * workspaceCount,
    // Headroom of one: a workspace restart briefly runs the new pod alongside
    // the old one, and a quota of exactly N makes that fail rather than wait.
    pods: workspaceCount + 1,
    persistentVolumeClaims: storage.pvcs,
    requestsStorageGiB: storage.gib,
  };

  const warnings: string[] = [];

  const headroomCpu = perWorkspace.cpuLimitMilli - EDITOR_CPU_MILLI;
  const headroomRam = perWorkspace.ramLimitMiB - EDITOR_RAM_MIB;
  // Inclusive: half a core and a gigabyte left for the workload is already
  // the point where a language server makes the editor unusable, so the
  // boundary case warrants the warning rather than just missing it.
  if (headroomCpu <= 500 || headroomRam <= 1024) {
    warnings.push(
      `che-code itself uses roughly ${EDITOR_CPU_MILLI}m and ${EDITOR_RAM_MIB}Mi inside the ` +
        `workspace container, leaving about ${headroomCpu}m and ${headroomRam}Mi for the ` +
        'actual workload. Builds and language servers will struggle.',
    );
  }

  if (input.storageMode === 'ephemeral') {
    warnings.push(
      'Ephemeral storage: /projects is lost when the workspace stops. Uncommitted work ' +
        'does not survive a restart, and Dev Spaces stops idle workspaces automatically.',
    );
  }

  if (workspaceCount > 1) {
    warnings.push(
      `The quota allows ${workspaceCount} workspaces to run at once, but Dev Spaces also ` +
        'enforces maxNumberOfRunningWorkspacesPerUser on the CheCluster, which is ' +
        'cluster-wide. If that is lower than this number, it wins.',
    );
  }

  // Echo back only the sizing fields, picked explicitly.
  //
  // Callers pass the whole request here, and a request carries an API key.
  // Returning the object as given put that key in `sizing.input` and
  // therefore in the plan response, past the redaction that guards
  // `request`. Narrowing it here means no caller can widen it by accident.
  const echoed: SizingInput = {
    workspaceCount,
    totalVcpu,
    totalRamGiB,
    storageGiB: input.storageGiB,
    storageMode: input.storageMode,
  };

  return { input: echoed, perWorkspace, quota, warnings };
}

/** Kubernetes quantity strings, which is what the manifests need. */
export const asCpu = (milli: number): string => `${milli}m`;
export const asMem = (miB: number): string => `${miB}Mi`;
