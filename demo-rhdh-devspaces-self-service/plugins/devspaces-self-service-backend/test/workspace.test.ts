import { describe, expect, it } from 'vitest';

import {
  devWorkspaceManifest,
  EditorDefinitionError,
  editorTemplateYaml,
  topLevelBlocks,
  workspaceUrl,
} from '../src/workspace';

/** Shaped like the real che-code.yaml, including a nested `metadata`. */
const EDITOR_DEFINITION = `commands:
  - apply:
      component: che-code-injector
    id: init-container-command
components:
  - container:
      image: registry.redhat.io/devspaces/code-rhel9@sha256:abc
      cpuLimit: 500m
    name: che-code-injector
  - attributes:
      metadata:
        name: nested-should-survive
    name: che-code-runtime-description
events:
  postStart:
    - init-che-code-command
metadata:
  name: che-code
  displayName: VS Code - Open Source
`;

describe('topLevelBlocks', () => {
  it('splits on column-zero keys only', () => {
    const blocks = topLevelBlocks(EDITOR_DEFINITION);
    expect([...blocks.keys()]).toEqual(['commands', 'components', 'events', 'metadata']);
  });

  it('keeps a nested metadata with its parent', () => {
    // The whole reason this is not a naive line filter: components contain
    // their own `metadata`, and dropping those would corrupt the editor.
    expect(topLevelBlocks(EDITOR_DEFINITION).get('components')).toContain(
      'nested-should-survive',
    );
  });
});

describe('editorTemplateYaml', () => {
  const yaml = editorTemplateYaml(EDITOR_DEFINITION, 'che-code-ws', 'andy-devspaces', 'andy');

  it('produces a DevWorkspaceTemplate in the right namespace', () => {
    expect(yaml).toContain('kind: DevWorkspaceTemplate');
    expect(yaml).toContain('name: che-code-ws');
    expect(yaml).toContain('namespace: andy-devspaces');
  });

  it("carries exactly the three keys the dashboard's own template has", () => {
    expect(yaml).toContain('  commands:');
    expect(yaml).toContain('  components:');
    expect(yaml).toContain('  events:');
  });

  it('drops the definition\'s own metadata, which is not part of the spec', () => {
    const spec = yaml.split('spec:')[1] as string;
    expect(spec).not.toContain('displayName: VS Code - Open Source');
    // ...but the nested one inside a component survives.
    expect(spec).toContain('nested-should-survive');
  });

  it('indents the copied blocks under spec', () => {
    expect(yaml).toMatch(/spec:\n {2}commands:/);
  });

  it('is labelled so it is found and removed with everything else', () => {
    expect(yaml).toContain('app.kubernetes.io/managed-by: devspaces-self-service');
  });

  it('refuses a definition that is not an editor', () => {
    expect(() => editorTemplateYaml('something: else\n', 'n', 'ns', 'u')).toThrow(
      EditorDefinitionError,
    );
  });
});

describe('devWorkspaceManifest', () => {
  const dw = devWorkspaceManifest({
    name: 'andy-devspace',
    namespace: 'andy-devspaces',
    username: 'andy',
    editorTemplateName: 'che-code-andy-devspace',
    devfile: {
      components: [
        { name: 'dev', container: { image: 'custom-udi', env: [{ name: 'DEFAULT_EXTENSIONS', value: '/opt/extensions/kilocode.vsix' }] } },
      ],
    },
    started: true,
    userEntityRef: 'user:default/andy',
  }) as any;

  it('routes through the Che gateway, or the editor is never reachable', () => {
    // Without this the pod runs fine and the workspace sits in Starting until
    // startTimeoutSeconds, then fails with "remains Starting in the last 300
    // seconds". Nothing in the pod looks wrong.
    expect(dw.spec.routingClass).toBe('che');
  });

  it('contributes the editor, since nothing injects one', () => {
    // Verified on Dev Spaces 3.30: a DevWorkspace with no contributions gets
    // no editor and no template created for it.
    expect(dw.spec.contributions).toEqual([
      { name: 'editor', kubernetes: { name: 'che-code-andy-devspace' } },
    ]);
  });

  it('carries the generated components, which is what makes the selection real', () => {
    const env = dw.spec.template.components[0].container.env;
    expect(env).toContainEqual({
      name: 'DEFAULT_EXTENSIONS',
      value: '/opt/extensions/kilocode.vsix',
    });
  });

  it('sets the attributes Dev Spaces expects', () => {
    const attrs = dw.spec.template.attributes;
    expect(attrs['controller.devfile.io/devworkspace-config']).toEqual({
      name: 'devworkspace-config',
      namespace: 'openshift-operators',
    });
    expect(attrs['controller.devfile.io/storage-type']).toBe('per-user');
  });

  it('asks for the container-build SCC, without which no workspace starts', () => {
    // Not a container-build nicety. This cluster's DevWorkspaceOperatorConfig
    // adds SETGID/SETUID and allowPrivilegeEscalation to every workspace, so
    // restricted-v2 refuses the pod. Setting this attribute is also what makes
    // the controller grant the workspace's ServiceAccount the SCC.
    expect(dw.spec.template.attributes['controller.devfile.io/scc']).toBe('container-build');
  });

  it('records who asked', () => {
    expect(dw.metadata.annotations['devspaces-self-service/requested-by']).toBe(
      'user:default/andy',
    );
  });
});

describe('workspaceUrl', () => {
  it('addresses the workspace by namespace and name', () => {
    expect(workspaceUrl('https://devspaces.example.com/', 'andy-devspaces', 'ws')).toBe(
      'https://devspaces.example.com/dashboard/#/ide/andy-devspaces/ws',
    );
  });
});
