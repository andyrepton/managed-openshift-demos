/**
 * What this cluster can actually offer, read from the cluster.
 *
 * The form must not invent its options. Offering Kilo when the image does not
 * carry it produces a workspace with a `DEFAULT_EXTENSIONS` path that does not
 * exist, and che-code logs a failure nobody will read. So the agent list comes
 * from a ConfigMap that `demo-custom-udi` publishes alongside the image it
 * built, and the Dev Spaces URL comes from the CheCluster.
 *
 * Everything degrades rather than failing. Off-cluster - in tests, or a local
 * dev server - there is no token, so this reports what it could not determine
 * and the UI says so instead of showing an empty form with no explanation.
 */

import { KubeClient, NoCredentialError } from './kube';

export interface AgentCapability {
  id: string;
  displayName: string;
  description: string;
  /** Absolute path of the .vsix inside the image, for DEFAULT_EXTENSIONS. */
  vsixPath?: string;
  /** Present for tools that are a binary rather than an extension. */
  binary?: string;
  version: string;
  /** False when the editor cannot install it - a CLI works anywhere. */
  editorOnly: boolean;
}

export interface Capabilities {
  /** The UDI the devfile should name. */
  image?: string;
  agents: AgentCapability[];
  /** Dev Spaces dashboard URL, for the factory link. */
  cheUrl?: string;
  /** In-cluster model endpoint, when one is configured and reachable. */
  inClusterAi?: { baseUrl: string; available: boolean; reason?: string };
  /**
   * The che-code editor definition, verbatim from the editors-definitions
   * ConfigMap. Needed to build the DevWorkspaceTemplate, because nothing
   * supplies an editor to a DevWorkspace automatically.
   */
  editorDefinition?: string;
  /**
   * The Che environment every workspace container needs.
   *
   * The dashboard injects these and a hand-built DevWorkspace does not, which
   * is not cosmetic: without them che-code's terminal environment resolution
   * finds a platform-keyed object with a null value and throws
   * `Cannot convert undefined or null to object` in applyPlatformSpecificKeys,
   * so no terminal can ever be opened. The editor itself works fine, which
   * makes it look like a terminal bug rather than missing configuration.
   */
  cheEnv?: { name: string; value: string }[];
  /** Why something above is missing. Shown to the user, not swallowed. */
  problems: string[];
}

export interface CapabilitiesOptions {
  kube: KubeClient;
  /** Namespace and name of the ConfigMap demo-custom-udi publishes. */
  udiNamespace?: string;
  udiConfigMap?: string;
  /** CheCluster to read the dashboard URL from. */
  cheNamespace?: string;
  cheName?: string;
  /** Key in the editors-definitions ConfigMap. */
  editorKey?: string;
  /** Configured in app-config; absent means the option is not offered. */
  inClusterAiBaseUrl?: string;
}

interface UdiManifest {
  image?: string;
  extensionDir?: string;
  tools?: {
    id: string;
    kind: string;
    displayName: string;
    description?: string;
    version: string;
    file?: string;
    binary?: string;
  }[];
}

/**
 * Agents, from the ConfigMap the image build published.
 *
 * The OpenCode CLI and the OpenCode editor shim are two entries in the
 * manifest but one choice for a user, so they are folded together here: the
 * CLI is what does the work, and the shim only adds a button. Offering them
 * separately would invite someone to pick the 2 KB shim on its own and get a
 * button that launches a binary that is not there.
 */
function foldAgents(manifest: UdiManifest): AgentCapability[] {
  const dir = manifest.extensionDir ?? '/opt/extensions';
  const tools = manifest.tools ?? [];
  const byId = new Map(tools.map(t => [t.id, t]));
  const out: AgentCapability[] = [];

  const kilo = byId.get('kilo-code');
  if (kilo?.file) {
    out.push({
      id: 'kilo-code',
      displayName: kilo.displayName,
      description: kilo.description ?? '',
      vsixPath: `${dir}/${kilo.file}`,
      version: kilo.version,
      editorOnly: true,
    });
  }

  const cli = byId.get('opencode-cli');
  const shim = byId.get('opencode-extension');
  if (cli) {
    out.push({
      id: 'opencode',
      displayName: 'OpenCode',
      description: cli.description ?? '',
      ...(shim?.file ? { vsixPath: `${dir}/${shim.file}` } : {}),
      ...(cli.binary ? { binary: cli.binary } : {}),
      version: cli.version,
      // The CLI runs in a terminal, so unlike Kilo this is not editor-bound.
      editorOnly: false,
    });
  }

  return out;
}

export async function readCapabilities(opts: CapabilitiesOptions): Promise<Capabilities> {
  const {
    kube,
    udiNamespace = 'custom-udi',
    udiConfigMap = 'udi-capabilities',
    cheNamespace = 'openshift-operators',
    cheName = 'devspaces',
    editorKey = 'che-code.yaml',
    inClusterAiBaseUrl,
  } = opts;

  const problems: string[] = [];
  const result: Capabilities = { agents: [], problems };

  try {
    const res = await kube.get(
      `/api/v1/namespaces/${udiNamespace}/configmaps/${udiConfigMap}`,
    );
    if (res.status === 200) {
      const data = (res.body as { data?: Record<string, string> }).data ?? {};
      const raw = data['capabilities.json'];
      if (raw) {
        const manifest = JSON.parse(raw) as UdiManifest;
        result.agents = foldAgents(manifest);
        if (manifest.image) result.image = manifest.image;
      } else {
        problems.push(
          `ConfigMap ${udiNamespace}/${udiConfigMap} has no capabilities.json key`,
        );
      }
    } else if (res.status === 404) {
      problems.push(
        `No ${udiNamespace}/${udiConfigMap} ConfigMap. Build the image and apply ` +
          'demo-custom-udi/capabilities-configmap.yaml to offer AI assistants.',
      );
    } else {
      problems.push(`Could not read the UDI capabilities: HTTP ${res.status}`);
    }
  } catch (err) {
    problems.push(
      err instanceof NoCredentialError
        ? 'No cluster credential, so the agent list could not be read.'
        : `Could not read the UDI capabilities: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  try {
    const res = await kube.get(
      `/apis/org.eclipse.che/v2/namespaces/${cheNamespace}/checlusters/${cheName}`,
    );
    if (res.status === 200) {
      const url = (res.body as { status?: { cheURL?: string } }).status?.cheURL;
      if (url) result.cheUrl = url;
      else problems.push('The CheCluster reports no dashboard URL yet.');
    } else {
      problems.push(
        `Could not read CheCluster ${cheNamespace}/${cheName}: HTTP ${res.status}. ` +
          'Is openshift-devspaces deployed?',
      );
    }
  } catch (err) {
    problems.push(
      err instanceof NoCredentialError
        ? 'No cluster credential, so the Dev Spaces URL could not be read.'
        : `Could not read the CheCluster: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Everything the dashboard puts in a workspace's environment, taken from
  // the same places the dashboard takes it.
  try {
    const che = await kube.get(
      `/apis/org.eclipse.che/v2/namespaces/${cheNamespace}/checlusters/${cheName}`,
    );
    const body = che.body as {
      status?: { cheURL?: string; pluginRegistryURL?: string };
      spec?: { components?: { pluginRegistry?: { openVSXURL?: string } } };
    };
    const dashboard = body.status?.cheURL;
    const registry = body.status?.pluginRegistryURL;

    let consoleUrl = '';
    const cm = await kube.get(
      '/api/v1/namespaces/openshift-config-managed/configmaps/console-public',
    );
    if (cm.status === 200) {
      consoleUrl = (cm.body as { data?: Record<string, string> }).data?.consoleURL ?? '';
    } else {
      problems.push(
        `Could not read the OpenShift console URL: HTTP ${cm.status}. Workspaces still ` +
          'start; the console link inside them is empty.',
      );
    }

    if (dashboard) {
      result.cheEnv = [
        { name: 'CHE_DASHBOARD_URL', value: dashboard },
        { name: 'CHE_PLUGIN_REGISTRY_URL', value: registry ?? `${dashboard}/plugin-registry/v3` },
        {
          name: 'CHE_PLUGIN_REGISTRY_INTERNAL_URL',
          value: `http://plugin-registry.${cheNamespace}.svc:8080/v3`,
        },
        { name: 'CLUSTER_CONSOLE_URL', value: consoleUrl },
        { name: 'CLUSTER_CONSOLE_TITLE', value: 'OpenShift console' },
        {
          name: 'OPENVSX_REGISTRY_URL',
          value: body.spec?.components?.pluginRegistry?.openVSXURL ?? '',
        },
        { name: 'HOST_USERS', value: 'true' },
      ];
    }
  } catch (err) {
    problems.push(
      `Could not build the Che workspace environment: ${err instanceof Error ? err.message : String(err)}. ` +
        'Workspaces may start without a working terminal.',
    );
  }

  try {
    const res = await kube.get(
      `/api/v1/namespaces/${cheNamespace}/configmaps/editors-definitions`,
    );
    if (res.status === 200) {
      const data = (res.body as { data?: Record<string, string> }).data ?? {};
      const definition = data[editorKey];
      if (definition) result.editorDefinition = definition;
      else problems.push(`editors-definitions has no ${editorKey} entry.`);
    } else {
      problems.push(
        `Could not read the editor definitions: HTTP ${res.status}. Workspaces ` +
          'cannot be created without one, though the namespace and quota still can.',
      );
    }
  } catch (err) {
    problems.push(
      err instanceof NoCredentialError
        ? 'No cluster credential, so the editor definition could not be read.'
        : `Could not read the editor definitions: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // The in-cluster endpoint is configured rather than discovered: it belongs
  // to demo-vllm-model-serving, which may not be deployed. Offering it when
  // nothing serves it produces a workspace whose agent times out on every
  // request, which is worse than not offering it.
  if (inClusterAiBaseUrl) {
    result.inClusterAi = { baseUrl: inClusterAiBaseUrl, available: true };
  }

  return result;
}
