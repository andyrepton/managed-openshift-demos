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

/**
 * What che-code adds to the workspace container.
 *
 * These are the editor's own figures from the `che-code-runtime-description`
 * component in the editors-definitions ConfigMap, and they are ADDED to
 * whatever the devfile asks for - the editor runs inside the same container,
 * and the DevWorkspace controller merges its resources in.
 *
 * Getting this wrong is not a rounding error. Asking for 2 vCPU / 4 GiB
 * produced a container of 2500m / 5Gi, which the namespace's own LimitRange
 * then rejected:
 *
 *   pods ... is forbidden: [maximum memory usage per Container is 4Gi, but
 *   limit is 5Gi, maximum cpu usage per Container is 2, but limit is 2500m]
 *
 * So the devfile asks for the total MINUS this, and the merged container
 * comes out at exactly what the user requested.
 */
export const EDITOR_CPU_MILLI = 500;
export const EDITOR_RAM_MIB = 1024;

/** The least the workload itself should get once the editor has taken its share. */
export const WORKLOAD_FLOOR_CPU_MILLI = 500;
export const WORKLOAD_FLOOR_RAM_MIB = 1024;

/**
 * Floor for a usable workspace: enough for the editor AND something to run.
 *
 * Derived rather than written down, so it cannot drift from the two figures
 * it depends on.
 */
export const MIN_WORKSPACE_CPU_MILLI = EDITOR_CPU_MILLI + WORKLOAD_FLOOR_CPU_MILLI;
export const MIN_WORKSPACE_RAM_MIB = EDITOR_RAM_MIB + WORKLOAD_FLOOR_RAM_MIB;

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
  /** The whole workspace container after the editor is merged in. */
  perWorkspace: WorkspaceSize;
  /**
   * What the devfile should ask for: the total minus the editor's share.
   *
   * The DevWorkspace controller adds the editor's resources to this, so the
   * container that actually runs equals `perWorkspace`.
   */
  workload: WorkspaceSize;
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

  /*
   * Both dimensions are checked together, and the message states the minimum
   * totals outright.
   *
   * Reporting them one at a time was actively misleading: too little of both
   * showed the vCPU message, so you raised vCPU, the message switched to
   * memory, and at a glance it looked like the same error refusing to clear.
   * Someone raised vCPU to 64 against a memory limit that no amount of vCPU
   * could satisfy.
   */
  const shortfalls: string[] = [];
  if (cpuLimitMilli < MIN_WORKSPACE_CPU_MILLI) {
    shortfalls.push(`${cpuLimitMilli}m of vCPU`);
  }
  if (ramLimitMiB < MIN_WORKSPACE_RAM_MIB) {
    shortfalls.push(`${ramLimitMiB}Mi of memory`);
  }

  if (shortfalls.length > 0) {
    const needVcpu = (MIN_WORKSPACE_CPU_MILLI * workspaceCount) / 1000;
    const needRam = (MIN_WORKSPACE_RAM_MIB * workspaceCount) / 1024;
    throw new SizingError(
      `${workspaceCount} workspace${workspaceCount === 1 ? '' : 's'} would get ` +
        `${shortfalls.join(' and ')} each, below what one needs to run the editor ` +
        `(${MIN_WORKSPACE_CPU_MILLI}m and ${MIN_WORKSPACE_RAM_MIB}Mi). ` +
        `For ${workspaceCount} workspace${workspaceCount === 1 ? '' : 's'} ask for at ` +
        `least ${needVcpu} vCPU and ${needRam} GiB in total` +
        `, or reduce the number of workspaces. ` +
        `You asked for ${totalVcpu} vCPU and ${totalRamGiB} GiB.`,
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

  // What the devfile asks for. The editor's share is added back by the
  // controller, so this plus the editor equals perWorkspace exactly.
  const workload: WorkspaceSize = {
    cpuLimitMilli: cpuLimitMilli - EDITOR_CPU_MILLI,
    ramLimitMiB: ramLimitMiB - EDITOR_RAM_MIB,
    cpuRequestMilli: Math.max(
      WORKLOAD_FLOOR_CPU_MILLI,
      Math.floor((cpuLimitMilli - EDITOR_CPU_MILLI) * REQUEST_FRACTION),
    ),
    ramRequestMiB: Math.max(
      WORKLOAD_FLOOR_RAM_MIB,
      Math.floor((ramLimitMiB - EDITOR_RAM_MIB) * REQUEST_FRACTION),
    ),
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

  // Inclusive: half a core and a gigabyte left for the workload is already
  // the point where a language server makes the editor unusable, so the
  // boundary case warrants the warning rather than just missing it.
  if (workload.cpuLimitMilli <= WORKLOAD_FLOOR_CPU_MILLI ||
      workload.ramLimitMiB <= WORKLOAD_FLOOR_RAM_MIB) {
    warnings.push(
      `che-code takes ${EDITOR_CPU_MILLI}m and ${EDITOR_RAM_MIB}Mi of each workspace, ` +
        `leaving ${workload.cpuLimitMilli}m and ${workload.ramLimitMiB}Mi for your own ` +
        'processes. Builds and language servers will struggle.',
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

  return { input: echoed, perWorkspace, workload, quota, warnings };
}

/** Kubernetes quantity strings, which is what the manifests need. */
export const asCpu = (milli: number): string => `${milli}m`;
export const asMem = (miB: number): string => `${miB}Mi`;
