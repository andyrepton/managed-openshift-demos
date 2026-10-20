/**
 * A request, turned into everything it implies.
 *
 * Pure. This is what the preview shows and what provision.ts applies, from
 * one function, so the two cannot drift. The only thing provisioning adds is
 * the real API key, which never appears in a preview.
 */

import type { Capabilities, AgentCapability } from './capabilities';
import { buildDevfile, factoryUrl, renderYaml } from './devfile';
import {
  aiSecretManifest,
  limitRangeManifest,
  namespaceFor,
  namespaceManifest,
  redactedAiSecret,
  resourceQuotaManifest,
  validateUsername,
} from './manifests';
import { computeSizing } from './sizing';
import type { DevSpaceRequest, GeneratedFile, PlanResponse } from './types';

export const STOCK_UDI = 'registry.redhat.io/devspaces/udi-rhel9:latest';

export interface PlanOptions {
  request: DevSpaceRequest;
  capabilities: Capabilities;
  /** Where the generated devfile will live, for the factory URL. */
  devfileRepoUrl?: string;
  devfilePath?: string;
}

export function planRequest(opts: PlanOptions): PlanResponse {
  const { request, capabilities } = opts;

  validateUsername(request.username);
  const sizing = computeSizing(request);
  const namespace = namespaceFor(request.username);
  const warnings = [...sizing.warnings];

  // Unknown agents are rejected rather than dropped. Silently ignoring one
  // produces a workspace missing the assistant the user asked for, and
  // nothing in the result says so.
  const known = new Map(capabilities.agents.map(a => [a.id, a]));
  const unknown = request.agents.filter(id => !known.has(id));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown assistant${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}. ` +
        `This cluster's image offers: ${[...known.keys()].join(', ') || 'none'}.`,
    );
  }
  const selected = request.agents.map(id => known.get(id) as AgentCapability);

  // An agent with nowhere to send requests is a button that returns an error.
  if (selected.length > 0 && request.ai.kind === 'none') {
    warnings.push(
      `${selected.map(a => a.displayName).join(' and ')} will be installed but has no ` +
        'model endpoint configured, so it will fail on first use. Choose an AI backend ' +
        'or remove the assistant.',
    );
  }
  if (selected.length === 0 && request.ai.kind !== 'none') {
    warnings.push(
      'An AI backend is configured but no assistant is selected, so nothing will use it.',
    );
  }

  if (request.ai.kind === 'in-cluster' && !capabilities.inClusterAi) {
    throw new Error(
      'This cluster has no in-cluster model endpoint configured. Deploy ' +
        'demo-vllm-model-serving and set devspacesSelfService.inClusterAiBaseUrl, ' +
        'or choose a third-party endpoint.',
    );
  }

  const image = capabilities.image ?? STOCK_UDI;
  if (!capabilities.image && selected.length > 0) {
    throw new Error(
      'No custom UDI is published on this cluster, so no assistant can be installed. ' +
        'Build demo-custom-udi first, or request a workspace with no assistant.',
    );
  }

  const devfile = buildDevfile({
    request,
    sizing,
    available: capabilities.agents,
    image,
    ...(capabilities.cheEnv ? { cheEnv: capabilities.cheEnv } : {}),
    ...(capabilities.inClusterAi ? { inClusterBaseUrl: capabilities.inClusterAi.baseUrl } : {}),
  });

  const files: GeneratedFile[] = [
    {
      path: `${namespace}/00-namespace.yaml`,
      purpose: 'The namespace, labelled so Dev Spaces adopts it instead of making its own',
      contents: renderYaml(namespaceManifest(request.username)),
      applied: true,
    },
    {
      path: `${namespace}/10-resourcequota.yaml`,
      purpose: 'What actually caps the namespace, sized to the workspaces requested',
      contents: renderYaml(resourceQuotaManifest(request.username, sizing)),
      applied: true,
    },
    {
      path: `${namespace}/20-limitrange.yaml`,
      purpose: 'Defaults for anything created without its own resources',
      contents: renderYaml(limitRangeManifest(request.username, sizing)),
      applied: true,
    },
    {
      path: `${namespace}/devfile.yaml`,
      purpose: 'The workspace definition. Names the image explicitly, which overrides the cluster default',
      contents: renderYaml(devfile),
      applied: false,
    },
  ];

  const secret = redactedAiSecret(request);
  if (secret) {
    files.push({
      path: `${namespace}/30-ai-credentials.yaml`,
      purpose:
        'The API key, mounted into workspaces as environment variables. Shown with the ' +
        'key redacted - the real value goes straight to the cluster and is never rendered back',
      contents: renderYaml(secret),
      applied: true,
    });
  }

  const response: PlanResponse = {
    request: redactRequest(request),
    namespace,
    sizing,
    files,
    warnings: [...warnings, ...capabilities.problems],
  };

  if (capabilities.cheUrl && opts.devfileRepoUrl) {
    response.factoryUrl = factoryUrl(
      capabilities.cheUrl,
      opts.devfileRepoUrl,
      opts.devfilePath,
    );
  }

  return response;
}

/** Never echo a key back, not even to the person who just typed it. */
function redactRequest(request: DevSpaceRequest): DevSpaceRequest {
  if (!request.ai.apiKey) return request;
  return { ...request, ai: { ...request.ai, apiKey: 'REDACTED' } };
}

/** The manifests to apply, in order. Secrets last so a failure leaves no key behind. */
export function manifestsToApply(request: DevSpaceRequest, capabilities: Capabilities) {
  const sizing = computeSizing(request);
  void capabilities;
  const out: { kind: string; name: string; path: string; manifest: object }[] = [
    {
      kind: 'Namespace',
      name: namespaceFor(request.username),
      path: `/api/v1/namespaces/${namespaceFor(request.username)}`,
      manifest: namespaceManifest(request.username),
    },
    {
      kind: 'ResourceQuota',
      name: 'devspaces-quota',
      path: `/api/v1/namespaces/${namespaceFor(request.username)}/resourcequotas/devspaces-quota`,
      manifest: resourceQuotaManifest(request.username, sizing),
    },
    {
      kind: 'LimitRange',
      name: 'devspaces-limits',
      path: `/api/v1/namespaces/${namespaceFor(request.username)}/limitranges/devspaces-limits`,
      manifest: limitRangeManifest(request.username, sizing),
    },
  ];

  const secret = aiSecretManifest(request);
  if (secret) {
    out.push({
      kind: 'Secret',
      name: 'devspaces-ai-credentials',
      path: `/api/v1/namespaces/${namespaceFor(request.username)}/secrets/devspaces-ai-credentials`,
      manifest: secret,
    });
  }

  return out;
}
