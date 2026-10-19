/**
 * The objects a request turns into.
 *
 * Pure: same input, same bytes. Nothing here talks to a cluster, so the
 * preview the user approves is exactly what provision.ts applies.
 *
 * Everything carries `app.kubernetes.io/managed-by: devspaces-self-service`.
 * This plugin can create namespaces, so being able to list everything it has
 * ever made - and delete it with one selector - is not a nicety.
 */

import { asCpu, asMem, type Sizing } from './sizing';
import type { DevSpaceRequest } from './types';

export const MANAGED_BY = 'devspaces-self-service';

/** Lower-case DNS label. Namespaces and usernames both have to be one. */
export const DNS_LABEL = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

/**
 * Per-user namespace name.
 *
 * Must match the CheCluster's `defaultNamespace.template`, which is
 * `<username>-devspaces` on this cluster. Get this wrong and Che provisions a
 * second namespace alongside ours - the quota lands on one and the workspace
 * on the other, so nothing is enforced and nothing says why.
 */
export function namespaceFor(username: string): string {
  return `${username}-devspaces`;
}

export function validateUsername(username: string): void {
  if (!username) throw new Error('username is required');
  if (!DNS_LABEL.test(username)) {
    throw new Error(
      `username "${username}" is not a DNS label. It becomes a namespace, so it must be ` +
        'lower-case letters, numbers and hyphens, starting and ending alphanumeric.',
    );
  }
  // 63 for the label, minus '-devspaces'.
  if (namespaceFor(username).length > 63) {
    throw new Error(`username "${username}" is too long: the namespace would exceed 63 characters`);
  }
}

const baseLabels = (username: string) => ({
  'app.kubernetes.io/managed-by': MANAGED_BY,
  'devspaces-self-service/username': username,
});

/**
 * The namespace, labelled so Che adopts it rather than creating its own.
 *
 * These three pieces of metadata are the whole trick. Che checks for a
 * namespace matching its template and, finding one labelled as a workspaces
 * namespace for this user, uses it as-is. That is what lets a quota exist
 * before the first workspace does, without turning off `autoProvision`
 * cluster-wide and breaking every other user.
 */
export function namespaceManifest(username: string): object {
  return {
    apiVersion: 'v1',
    kind: 'Namespace',
    metadata: {
      name: namespaceFor(username),
      labels: {
        ...baseLabels(username),
        'app.kubernetes.io/part-of': 'che.eclipse.org',
        'app.kubernetes.io/component': 'workspaces-namespace',
      },
      annotations: {
        'che.eclipse.org/username': username,
        'openshift.io/display-name': `Dev Spaces - ${username}`,
      },
    },
  };
}

export function resourceQuotaManifest(username: string, sizing: Sizing): object {
  const q = sizing.quota;
  const hard: Record<string, string> = {
    'requests.cpu': asCpu(q.requestsCpuMilli),
    'requests.memory': asMem(q.requestsRamMiB),
    'limits.cpu': asCpu(q.limitsCpuMilli),
    'limits.memory': asMem(q.limitsRamMiB),
    pods: String(q.pods),
  };
  // Omitted rather than set to zero when ephemeral: a hard limit of 0 PVCs
  // rejects the workspace outright, where omitting the key simply does not
  // constrain something that is not being used.
  if (q.persistentVolumeClaims > 0) {
    hard['persistentvolumeclaims'] = String(q.persistentVolumeClaims);
    hard['requests.storage'] = `${q.requestsStorageGiB}Gi`;
  }

  return {
    apiVersion: 'v1',
    kind: 'ResourceQuota',
    metadata: {
      name: 'devspaces-quota',
      namespace: namespaceFor(username),
      labels: baseLabels(username),
    },
    spec: { hard },
  };
}

/**
 * Defaults for anything created without its own resources.
 *
 * Without this, a pod with no resources set is admitted with no limits and
 * can consume the whole quota on its own, and the next workspace fails to
 * start for reasons that point nowhere near the cause.
 */
export function limitRangeManifest(username: string, sizing: Sizing): object {
  const w = sizing.perWorkspace;
  return {
    apiVersion: 'v1',
    kind: 'LimitRange',
    metadata: {
      name: 'devspaces-limits',
      namespace: namespaceFor(username),
      labels: baseLabels(username),
    },
    spec: {
      limits: [
        {
          type: 'Container',
          default: { cpu: asCpu(w.cpuLimitMilli), memory: asMem(w.ramLimitMiB) },
          defaultRequest: { cpu: asCpu(w.cpuRequestMilli), memory: asMem(w.ramRequestMiB) },
          max: { cpu: asCpu(w.cpuLimitMilli), memory: asMem(w.ramLimitMiB) },
        },
      ],
    },
  };
}

/**
 * The AI credential, as a Secret the workspace mounts as environment variables.
 *
 * This is the only supported place for it. A token in the devfile would be
 * committed to git; a token in the ResourceQuota would be absurd. Dev Spaces
 * mounts any Secret in the user's namespace carrying these two labels, and
 * `mount-as: env` turns each key into an environment variable in every
 * workspace container.
 *
 * Returns null when there is no third-party credential, so the caller emits
 * no Secret at all rather than an empty one.
 */
export function aiSecretManifest(request: DevSpaceRequest): object | null {
  if (request.ai.kind !== 'third-party') return null;
  if (!request.ai.baseUrl) throw new Error('a third-party AI backend needs a baseUrl');
  if (!request.ai.apiKey) throw new Error('a third-party AI backend needs an API key');

  return {
    apiVersion: 'v1',
    kind: 'Secret',
    metadata: {
      name: 'devspaces-ai-credentials',
      namespace: namespaceFor(request.username),
      labels: {
        ...baseLabels(request.username),
        'controller.devfile.io/mount-to-devworkspace': 'true',
        'controller.devfile.io/watch-secret': 'true',
      },
      annotations: {
        'controller.devfile.io/mount-as': 'env',
      },
    },
    type: 'Opaque',
    stringData: {
      AI_BASE_URL: request.ai.baseUrl,
      AI_API_KEY: request.ai.apiKey,
      ...(request.ai.model ? { AI_MODEL: request.ai.model } : {}),
    },
  };
}

/**
 * The Secret as it should appear in a preview or a git repository.
 *
 * Same object with the key replaced. The real value only ever travels from
 * the browser to the API and into the cluster; it is never rendered back, so
 * an approval screen cannot leak it and neither can a screenshot.
 */
export function redactedAiSecret(request: DevSpaceRequest): object | null {
  const secret = aiSecretManifest(request) as
    | { stringData: Record<string, string> }
    | null;
  if (!secret) return null;
  return { ...secret, stringData: { ...secret.stringData, AI_API_KEY: 'REPLACE_ME' } };
}
