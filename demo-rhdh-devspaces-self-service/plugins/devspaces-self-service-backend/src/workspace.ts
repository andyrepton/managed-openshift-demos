/**
 * Creating the workspace itself, not just the namespace it lives in.
 *
 * Without this the assistant checkboxes only ever changed a devfile nobody
 * applied: Dev Spaces creates workspaces, and it uses whichever devfile it is
 * handed, so a workspace started from the dashboard got the cluster default
 * image and no extensions. The selection was a document.
 *
 * A DevWorkspace needs an editor, and nothing supplies one automatically -
 * verified on Dev Spaces 3.30: a DevWorkspace with no `contributions` gets no
 * editor injected and no template created. The dashboard does that work, so
 * when we bypass the dashboard we have to do it too.
 *
 * The editor definition is copied verbatim out of the `editors-definitions`
 * ConfigMap into a DevWorkspaceTemplate. Its `commands`, `components` and
 * `events` become the template's `spec` - checked against a template the
 * dashboard itself produced, which has exactly those three keys.
 */

const TEMPLATE_API = 'workspace.devfile.io/v1alpha2';

/** Keys of the editor definition that belong in the template's spec. */
const SPEC_KEYS = ['commands', 'components', 'events'];

/**
 * Split a YAML document into its top-level blocks.
 *
 * Only column-zero keys start a block, so a nested `metadata:` inside a
 * component stays with its parent. The editor definitions are machine-written
 * and uniformly indented, which is what makes this safe; it is not a general
 * YAML parser and does not pretend to be.
 */
export function topLevelBlocks(yaml: string): Map<string, string> {
  const blocks = new Map<string, string>();
  let current: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    if (current) blocks.set(current, buffer.join('\n').replace(/\s+$/, ''));
  };

  for (const line of yaml.split('\n')) {
    const match = /^([A-Za-z_][\w.-]*):\s*(.*)$/.exec(line);
    if (match) {
      flush();
      current = match[1] as string;
      buffer = [line];
    } else if (current) {
      buffer.push(line);
    }
  }
  flush();
  return blocks;
}

export class EditorDefinitionError extends Error {}

/**
 * A DevWorkspaceTemplate carrying the editor, as YAML.
 *
 * YAML rather than an object because the editor definition arrives as YAML
 * and is copied through untouched. Parsing it to re-serialise it would mean
 * adding a YAML library and would risk changing something subtle in a
 * document we do not own.
 */
export function editorTemplateYaml(
  editorDefinition: string,
  name: string,
  namespace: string,
  username: string,
): string {
  const blocks = topLevelBlocks(editorDefinition);
  const present = SPEC_KEYS.filter(k => blocks.has(k));

  if (!present.includes('components')) {
    throw new EditorDefinitionError(
      'The editor definition has no `components`. Expected the che-code entry from ' +
        'the editors-definitions ConfigMap; got something else.',
    );
  }

  // Two spaces, because the whole block moves under `spec:`.
  const spec = present
    .map(key => (blocks.get(key) as string).split('\n').map(l => `  ${l}`).join('\n'))
    .join('\n');

  return [
    `apiVersion: ${TEMPLATE_API}`,
    'kind: DevWorkspaceTemplate',
    'metadata:',
    `  name: ${name}`,
    `  namespace: ${namespace}`,
    '  labels:',
    '    app.kubernetes.io/managed-by: devspaces-self-service',
    `    devspaces-self-service/username: ${username}`,
    'spec:',
    spec,
    '',
  ].join('\n');
}

export interface DevWorkspaceOptions {
  name: string;
  namespace: string;
  username: string;
  editorTemplateName: string;
  /** The generated devfile: components, and projects when a repo was given. */
  devfile: { components?: unknown[]; projects?: unknown[] };
  /** Start it immediately. */
  started: boolean;
  userEntityRef: string;
}

/**
 * The DevWorkspace.
 *
 * The attributes are not decoration. `devworkspace-config` points it at the
 * operator config Dev Spaces manages, and `storage-type` has to agree with the
 * CheCluster's pvcStrategy or the workspace gets a volume layout Che does not
 * expect.
 *
 * **`controller.devfile.io/scc: container-build` is required, not optional.**
 * It looks like a container-build nicety and is not: this cluster's
 * DevWorkspaceOperatorConfig sets
 *
 *   containerSecurityContext: {allowPrivilegeEscalation: true,
 *                              capabilities: {add: [SETGID, SETUID]}}
 *
 * for EVERY workspace, so `restricted-v2` refuses the pod and it never starts:
 *
 *   pods ... is forbidden: unable to validate against any security context
 *   constraint: ... capability may not be added: "SETUID" ...
 *
 * Setting this attribute is also what makes the DevWorkspace controller create
 * the `devworkspace-use-container-build` Role and RoleBinding granting the
 * *workspace's* ServiceAccount that SCC. Without the attribute there is no
 * binding and nothing can admit the pod.
 *
 * The admission webhook additionally requires that whoever CREATES the
 * workspace may use the SCC, which stops this being an escalation path - so
 * the provisioner is granted it explicitly in rbac/provisioner.yaml.
 */
export function devWorkspaceManifest(opts: DevWorkspaceOptions): object {
  return {
    apiVersion: TEMPLATE_API,
    kind: 'DevWorkspace',
    metadata: {
      name: opts.name,
      namespace: opts.namespace,
      labels: {
        'app.kubernetes.io/managed-by': 'devspaces-self-service',
        'devspaces-self-service/username': opts.username,
      },
      annotations: {
        'devspaces-self-service/requested-by': opts.userEntityRef,
      },
    },
    spec: {
      /*
       * Without `routingClass: che` the DevWorkspace falls back to the
       * default routing, no Che gateway route is created, and the editor is
       * unreachable. The pod runs perfectly and the workspace never leaves
       * Starting, failing after the CheCluster's startTimeoutSeconds with:
       *
       *   The workspace status remains "Starting" in the last 300 seconds.
       *
       * Nothing in the pod looks wrong, which is what makes it hard to find.
       */
      routingClass: 'che',
      started: opts.started,
      contributions: [{ name: 'editor', kubernetes: { name: opts.editorTemplateName } }],
      template: {
        attributes: {
          'controller.devfile.io/devworkspace-config': {
            name: 'devworkspace-config',
            namespace: 'openshift-operators',
          },
          'controller.devfile.io/scc': 'container-build',
          'controller.devfile.io/storage-type': 'per-user',
        },
        ...(opts.devfile.components ? { components: opts.devfile.components } : {}),
        ...(opts.devfile.projects ? { projects: opts.devfile.projects } : {}),
      },
    },
  };
}

/**
 * Where the running workspace lives.
 *
 * The dashboard addresses a workspace by namespace and name, so this is
 * constructible without waiting for the workspace to report a URL - which
 * matters, because starting one takes longer than an HTTP request should.
 */
export function workspaceUrl(cheUrl: string, namespace: string, name: string): string {
  return `${cheUrl.replace(/\/+$/, '')}/dashboard/#/ide/${namespace}/${name}`;
}
