/**
 * The devfile a request produces.
 *
 * Two things here are load-bearing and neither is obvious.
 *
 * **The image must be named explicitly.** A devfile that declares its own
 * container image overrides the CheCluster's `defaultComponents`. Relying on
 * the cluster default would work right up until someone requests an agent, at
 * which point they would get the stock UDI with no `.vsix` files on disk and
 * an editor that silently installs nothing.
 *
 * **Agents are selected, not installed.** The `.vsix` files are already in the
 * image; `DEFAULT_EXTENSIONS` is a semicolon-separated list of absolute paths
 * that che-code installs at editor startup. One image therefore serves every
 * combination - no agent, one, or both - and selecting none means omitting the
 * variable rather than building a different image. Verified on Dev Spaces
 * 3.30: `DefaultExtensionsInstaller: Successfully installed extension from
 * /opt/extensions/kilocode.vsix`.
 */

import type { AgentCapability } from './capabilities';
import type { DevSpaceRequest } from './types';
import { asCpu, asMem, type Sizing } from './sizing';

/** Minimal YAML writer. The devfile shapes used here are small and known. */
function toYaml(value: unknown, indent = 0): string {
  const pad = '  '.repeat(indent);

  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    // Quote anything that could be read as another type, contain a comment, or
    // break the line. A bare `3.14` as a version string becomes a number.
    const needsQuote =
      value === '' ||
      /^[\s"'`#&*!|>%@-]|[\s:#]|^(true|false|null|~)$|^-?\d+(\.\d+)?$/i.test(value);
    if (value.includes('\n')) {
      const lines = value.replace(/\n$/, '').split('\n');
      return `|\n${lines.map(l => `${pad}  ${l}`).join('\n')}`;
    }
    return needsQuote ? `'${value.replace(/'/g, "''")}'` : value;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return value
      .map(item => {
        const rendered = toYaml(item, indent + 1);
        return typeof item === 'object' && item !== null
          ? `\n${pad}- ${rendered.replace(/^\s+/, '')}`
          : `\n${pad}- ${rendered}`;
      })
      .join('');
  }

  const entries = Object.entries(value as Record<string, unknown>).filter(
    ([, v]) => v !== undefined,
  );
  if (entries.length === 0) return '{}';
  return entries
    .map(([k, v]) => {
      const rendered = toYaml(v, indent + 1);
      const scalar = typeof v !== 'object' || v === null;
      if (scalar || rendered === '{}' || rendered === '[]') return `\n${pad}${k}: ${rendered}`;
      if (Array.isArray(v)) return `\n${pad}${k}:${rendered}`;
      return `\n${pad}${k}:${rendered}`;
    })
    .join('');
}

export function renderYaml(doc: object): string {
  return `${toYaml(doc).replace(/^\n/, '')}\n`;
}

export interface DevfileOptions {
  request: DevSpaceRequest;
  sizing: Sizing;
  /** Agents available in the image, from the published capability list. */
  available: AgentCapability[];
  /** The UDI to run. */
  image: string;
  /** In-cluster model endpoint, when that backend was chosen. */
  inClusterBaseUrl?: string;
}

/**
 * Environment the agents read.
 *
 * The third-party key is deliberately absent: it arrives from the Secret,
 * which Dev Spaces mounts as environment variables into every workspace
 * container. Writing it here would put it in a file destined for git.
 */
function aiEnv(opts: DevfileOptions): { name: string; value: string }[] {
  const { request, inClusterBaseUrl } = opts;
  if (request.ai.kind === 'in-cluster') {
    if (!inClusterBaseUrl) {
      throw new Error(
        'an in-cluster AI backend was requested but no endpoint is configured - ' +
          'demo-vllm-model-serving must be deployed first',
      );
    }
    return [
      { name: 'AI_BASE_URL', value: inClusterBaseUrl },
      ...(request.ai.model ? [{ name: 'AI_MODEL', value: request.ai.model }] : []),
    ];
  }
  // third-party: AI_BASE_URL, AI_API_KEY and AI_MODEL all come from the Secret.
  return [];
}

export function buildDevfile(opts: DevfileOptions): object {
  const { request, sizing, available, image } = opts;
  // The workload share, NOT the whole workspace: the DevWorkspace controller
  // merges che-code's own resources into this container, so asking for the
  // full figure here produces a container bigger than the quota allows.
  const w = sizing.workload;

  const selected = available.filter(a => request.agents.includes(a.id));
  const vsixPaths = selected.filter(a => a.vsixPath).map(a => a.vsixPath as string);

  const env = [
    ...aiEnv(opts),
    ...(vsixPaths.length > 0
      ? [{ name: 'DEFAULT_EXTENSIONS', value: vsixPaths.join(';') }]
      : []),
  ];

  return {
    schemaVersion: '2.2.2',
    metadata: {
      name: `${request.username}-devspace`,
      displayName: `Dev Space for ${request.username}`,
      description:
        selected.length > 0
          ? `Workspace with ${selected.map(a => a.displayName).join(' and ')}`
          : 'Workspace with no AI assistant',
    },
    components: [
      {
        name: 'dev',
        container: {
          image,
          cpuRequest: asCpu(w.cpuRequestMilli),
          cpuLimit: asCpu(w.cpuLimitMilli),
          memoryRequest: asMem(w.ramRequestMiB),
          memoryLimit: asMem(w.ramLimitMiB),
          mountSources: true,
          sourceMapping: '/projects',
          ...(env.length > 0 ? { env } : {}),
        },
      },
    ],
    ...(request.repoUrl
      ? {
          projects: [
            {
              name: projectNameFor(request.repoUrl),
              git: { remotes: { origin: request.repoUrl } },
            },
          ],
        }
      : {}),
  };
}

/** Last path segment of a git URL, minus .git, as a DNS label. */
export function projectNameFor(repoUrl: string): string {
  const last = repoUrl.replace(/\/+$/, '').split('/').pop() ?? 'project';
  const name = last
    .replace(/\.git$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/^-+|-+$/g, '');
  return name || 'project';
}

/**
 * Factory URL that opens the workspace.
 *
 * Dev Spaces takes the repository as a `#` fragment with parameters appended
 * to it. A `/f?url=` query string does not work - that form is in the older
 * docs and silently lands on the dashboard instead.
 */
export function factoryUrl(cheUrl: string, repoUrl: string, devfilePath?: string): string {
  const base = cheUrl.replace(/\/+$/, '');
  const suffix = devfilePath ? `?devfilePath=${devfilePath}` : '';
  return `${base}#${repoUrl}${suffix}`;
}
