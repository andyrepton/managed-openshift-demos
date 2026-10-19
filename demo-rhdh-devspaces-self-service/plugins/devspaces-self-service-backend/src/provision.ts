/**
 * Applying a plan to the cluster.
 *
 * The one part of this plugin that writes. Three rules shape it:
 *
 * **The caller's identity decides the namespace, not the request body.** A
 * username in the payload would let anyone provision in anyone else's name.
 *
 * **Only this plugin's own namespaces.** Every write is checked against the
 * `<username>-devspaces` pattern derived from the caller, so a malformed or
 * hostile path cannot reach `kube-system`. The ServiceAccount is scoped too,
 * but a check here fails with a sentence instead of a 403.
 *
 * **Refuse to adopt a namespace that is not ours.** If one already exists
 * without our label, something else owns it - another team's project, or a
 * Che namespace with a quota someone set deliberately - and quietly applying
 * a quota over the top is how a self-service tool breaks production.
 */

import type { Capabilities } from './capabilities';
import { assertOk, KubeClient, KubeError } from './kube';
import { MANAGED_BY, namespaceFor } from './manifests';
import { manifestsToApply } from './plan';
import type { DevSpaceRequest, ProvisionResult } from './types';

export class RefusedError extends Error {}

export interface ProvisionOptions {
  kube: KubeClient;
  request: DevSpaceRequest;
  capabilities: Capabilities;
  /** Entity ref of the caller, recorded on everything created. */
  userEntityRef: string;
}

/**
 * Is an existing namespace one we may write into?
 *
 * Ours if we made it. Also ours if Che made it for this user and nobody has
 * put a quota in it - that is the ordinary case of a developer who opened a
 * workspace before asking for one, and refusing there would be obstructive
 * for no benefit.
 */
async function inspectNamespace(
  kube: KubeClient,
  name: string,
  username: string,
): Promise<{ exists: boolean; adoptable: boolean; reason?: string }> {
  const res = await kube.get(`/api/v1/namespaces/${name}`);
  if (res.status === 404) return { exists: false, adoptable: true };
  assertOk(res, `reading namespace ${name}`);

  const meta = (res.body as { metadata?: { labels?: Record<string, string>; annotations?: Record<string, string> } })
    .metadata ?? {};
  const labels = meta.labels ?? {};
  const annotations = meta.annotations ?? {};

  if (labels['app.kubernetes.io/managed-by'] === MANAGED_BY) {
    return { exists: true, adoptable: true };
  }

  const cheOwned =
    labels['app.kubernetes.io/part-of'] === 'che.eclipse.org' &&
    annotations['che.eclipse.org/username'] === username;
  if (cheOwned) return { exists: true, adoptable: true };

  return {
    exists: true,
    adoptable: false,
    reason:
      `Namespace ${name} already exists and is not managed by this plugin or by Dev ` +
      `Spaces for ${username}. Refusing to apply a quota over something another owner ` +
      'created. Delete it, or have an administrator label it.',
  };
}

export async function provision(opts: ProvisionOptions): Promise<ProvisionResult> {
  const { kube, request, capabilities, userEntityRef } = opts;
  const namespace = namespaceFor(request.username);

  const existing = await inspectNamespace(kube, namespace, request.username);
  if (!existing.adoptable) throw new RefusedError(existing.reason as string);

  const manifests = manifestsToApply(request, capabilities);

  // Defence in depth. The ServiceAccount cannot write outside these paths
  // either, but a 403 from the API server is a worse error message than this.
  for (const m of manifests) {
    const expected =
      m.kind === 'Namespace'
        ? `/api/v1/namespaces/${namespace}`
        : `/api/v1/namespaces/${namespace}/`;
    const ok = m.kind === 'Namespace' ? m.path === expected : m.path.startsWith(expected);
    if (!ok) {
      throw new RefusedError(
        `Refusing to apply ${m.kind} ${m.name}: path ${m.path} is outside ${namespace}.`,
      );
    }
  }

  const applied: ProvisionResult['applied'] = [];

  for (const m of manifests) {
    // Record who asked, on every object. A plugin that can create namespaces
    // should leave an audit trail that does not depend on log retention.
    const manifest = withRequester(m.manifest, userEntityRef);
    const existedBefore = m.kind === 'Namespace' ? existing.exists : await exists(kube, m.path);

    try {
      const res = await kube.apply(m.path, manifest);
      assertOk(res, `applying ${m.kind} ${m.name}`);
    } catch (err) {
      if (err instanceof KubeError && err.status === 403) {
        throw new RefusedError(
          `The provisioner ServiceAccount may not create ${m.kind} in ${namespace}. ` +
            'Apply rbac/provisioner.yaml, or check it was not scoped more tightly than ' +
            `this plugin needs. Original error: ${err.message}`,
        );
      }
      throw err;
    }

    applied.push({ kind: m.kind, name: m.name, created: !existedBefore });
  }

  const result: ProvisionResult = { namespace, applied, ...openWhere(opts) };
  return result;
}

/**
 * Where to send the user next, and how honest to be about it.
 *
 * This plugin creates the namespace a workspace will live in; it does not
 * create the workspace. Dev Spaces does that, from a devfile, when someone
 * opens a factory URL.
 *
 * So there are two cases and they differ in an important way:
 *
 *   * A repository was given - the factory URL opens a workspace from it.
 *     If that repository contains its own devfile, THAT devfile wins, and the
 *     assistants chosen here do not apply. Most do not, in which case the
 *     cluster default image is used - also not the one generated here.
 *   * No repository - there is nowhere to send them but the dashboard.
 *
 * Either way the generated devfile is the thing that carries the image and
 * the assistant selection, and using it is a deliberate act. `exact` says
 * whether following this link reproduces what was requested, so the UI can
 * say so rather than implying a fidelity it does not have.
 */
function openWhere(opts: ProvisionOptions): {
  openUrl?: string;
  openLabel?: string;
  exact?: boolean;
} {
  const cheUrl = opts.capabilities.cheUrl;
  if (!cheUrl) return {};

  const base = cheUrl.replace(/\/+$/, '');
  if (opts.request.repoUrl) {
    return {
      openUrl: `${base}#${opts.request.repoUrl}`,
      openLabel: 'Open a workspace from your repository',
      exact: false,
    };
  }
  return { openUrl: base, openLabel: 'Open Dev Spaces', exact: false };
}

async function exists(kube: KubeClient, path: string): Promise<boolean> {
  const res = await kube.get(path);
  return res.status >= 200 && res.status < 300;
}

function withRequester(manifest: object, userEntityRef: string): object {
  const m = manifest as { metadata?: Record<string, unknown> };
  const metadata = { ...(m.metadata ?? {}) };
  metadata.annotations = {
    ...((metadata.annotations as Record<string, string>) ?? {}),
    'devspaces-self-service/requested-by': userEntityRef,
  };
  return { ...manifest, metadata };
}
