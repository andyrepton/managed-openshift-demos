import { describe, expect, it, vi } from 'vitest';

import type { Capabilities } from '../src/capabilities';
import {
  assertProvisioner,
  GuestNotAllowedError,
  NotAuthenticatedError,
  usernameFromRef,
} from '../src/identity';
import { KubeClient, type KubeRequester } from '../src/kube';
import { aiSecretManifest, namespaceFor, redactedAiSecret, validateUsername } from '../src/manifests';
import { planRequest } from '../src/plan';
import { provision, RefusedError } from '../src/provision';
import type { DevSpaceRequest } from '../src/types';

const capabilities: Capabilities = {
  image: 'image-registry.openshift-image-registry.svc:5000/custom-udi/custom-udi:latest',
  cheUrl: 'https://devspaces.example.com',
  agents: [
    {
      id: 'kilo-code',
      displayName: 'Kilo Code',
      description: '',
      vsixPath: '/opt/extensions/kilocode.vsix',
      version: '7.8.14',
      editorOnly: true,
    },
    {
      id: 'opencode',
      displayName: 'OpenCode',
      description: '',
      vsixPath: '/opt/extensions/opencode.vsix',
      binary: 'opencode',
      version: '1.19.3',
      editorOnly: false,
    },
  ],
  problems: [],
};

const request: DevSpaceRequest = {
  username: 'andyrepton',
  workspaceCount: 2,
  totalVcpu: 4,
  totalRamGiB: 8,
  storageGiB: 10,
  storageMode: 'persistent',
  agents: ['kilo-code'],
  ai: { kind: 'none' },
};

describe('identity', () => {
  it('reads a username out of an entity ref', () => {
    expect(usernameFromRef('user:default/andyrepton')).toBe('andyrepton');
    expect(usernameFromRef('user:development/guest')).toBe('guest');
  });

  it('refuses an unauthenticated caller', () => {
    expect(() => assertProvisioner(undefined)).toThrow(NotAuthenticatedError);
  });

  it('refuses guest, whatever the cluster sign-in config happens to be', () => {
    // Guest is installation-wide and someone may enable it for another demo.
    // This plugin creates namespaces, so it refuses rather than inheriting
    // whatever auth.environment says that week.
    expect(() => assertProvisioner('user:development/guest')).toThrow(GuestNotAllowedError);
    expect(() => assertProvisioner('USER:DEVELOPMENT/GUEST')).toThrow(GuestNotAllowedError);
  });

  it('accepts a real user', () => {
    expect(assertProvisioner('user:default/andyrepton')).toEqual({
      userEntityRef: 'user:default/andyrepton',
      username: 'andyrepton',
    });
  });
});

describe('usernames and namespaces', () => {
  it('matches the CheCluster template', () => {
    expect(namespaceFor('andyrepton')).toBe('andyrepton-devspaces');
  });

  it('rejects anything that is not a DNS label', () => {
    expect(() => validateUsername('Andy.Repton')).toThrow(/DNS label/);
    expect(() => validateUsername('andy_repton')).toThrow(/DNS label/);
    expect(() => validateUsername('-andy')).toThrow(/DNS label/);
    expect(() => validateUsername('a'.repeat(60))).toThrow(/63 characters/);
  });
});

describe('the AI credential', () => {
  const withKey: DevSpaceRequest = {
    ...request,
    ai: { kind: 'third-party', baseUrl: 'https://api.example.com/v1', apiKey: 'sk-secret' },
  };

  it('carries the labels Dev Spaces needs to mount it', () => {
    const s = aiSecretManifest(withKey) as any;
    expect(s.metadata.labels['controller.devfile.io/mount-to-devworkspace']).toBe('true');
    expect(s.metadata.labels['controller.devfile.io/watch-secret']).toBe('true');
    expect(s.metadata.annotations['controller.devfile.io/mount-as']).toBe('env');
  });

  it('is absent when there is no third-party backend', () => {
    expect(aiSecretManifest(request)).toBeNull();
  });

  it('never renders the key back in a preview', () => {
    const redacted = redactedAiSecret(withKey) as any;
    expect(redacted.stringData.AI_API_KEY).toBe('REPLACE_ME');
    expect(JSON.stringify(redacted)).not.toContain('sk-secret');
  });

  it('keeps the key out of the devfile, which is destined for git', () => {
    const plan = planRequest({ request: withKey, capabilities });
    const devfile = plan.files.find(f => f.path.endsWith('devfile.yaml'))!;
    expect(devfile.contents).not.toContain('sk-secret');
    expect(JSON.stringify(plan)).not.toContain('sk-secret');
  });
});

describe('planRequest', () => {
  it('names the image explicitly, because a devfile image beats the cluster default', () => {
    const plan = planRequest({ request, capabilities });
    const devfile = plan.files.find(f => f.path.endsWith('devfile.yaml'))!;
    expect(devfile.contents).toContain(capabilities.image as string);
  });

  it('selects only the agents asked for', () => {
    const plan = planRequest({ request, capabilities });
    const devfile = plan.files.find(f => f.path.endsWith('devfile.yaml'))!;
    expect(devfile.contents).toContain('/opt/extensions/kilocode.vsix');
    expect(devfile.contents).not.toContain('/opt/extensions/opencode.vsix');
  });

  it('omits DEFAULT_EXTENSIONS entirely when no agent is wanted', () => {
    const plan = planRequest({ request: { ...request, agents: [] }, capabilities });
    const devfile = plan.files.find(f => f.path.endsWith('devfile.yaml'))!;
    expect(devfile.contents).not.toContain('DEFAULT_EXTENSIONS');
  });

  it('rejects an agent this image does not carry', () => {
    expect(() => planRequest({ request: { ...request, agents: ['copilot'] }, capabilities })).toThrow(
      /Unknown assistant/,
    );
  });

  it('warns when an agent has no endpoint to talk to', () => {
    const plan = planRequest({ request, capabilities });
    expect(plan.warnings.join(' ')).toMatch(/no model endpoint configured/);
  });

  it('refuses in-cluster AI when nothing serves it', () => {
    expect(() =>
      planRequest({ request: { ...request, ai: { kind: 'in-cluster' } }, capabilities }),
    ).toThrow(/demo-vllm-model-serving/);
  });

  it('refuses an agent when no custom UDI is published', () => {
    const { image, ...withoutImage } = capabilities;
    void image;
    expect(() => planRequest({ request, capabilities: withoutImage as Capabilities })).toThrow(
      /No custom UDI/,
    );
  });
});

/** A fake API server that records what was written. */
function fakeKube(existing: Record<string, unknown> = {}) {
  const writes: { method: string; path: string; body: unknown }[] = [];
  const request: KubeRequester = async (method, path, body) => {
    const clean = path.split('?')[0] as string;
    if (method === 'GET') {
      return clean in existing
        ? { status: 200, body: existing[clean] }
        : { status: 404, body: { message: 'not found' } };
    }
    writes.push({ method, path: clean, body });
    return { status: 200, body: {} };
  };
  return { kube: new KubeClient({ request }), writes };
}

describe('provision', () => {
  it('creates the namespace, quota and limit range', async () => {
    const { kube, writes } = fakeKube();
    const result = await provision({
      kube,
      request,
      capabilities,
      userEntityRef: 'user:default/andyrepton',
    });
    expect(result.namespace).toBe('andyrepton-devspaces');
    expect(result.applied.map(a => a.kind)).toEqual(['Namespace', 'ResourceQuota', 'LimitRange']);
    expect(writes.every(w => w.method === 'PATCH')).toBe(true);
  });

  it('records who asked for it on every object', async () => {
    const { kube, writes } = fakeKube();
    await provision({ kube, request, capabilities, userEntityRef: 'user:default/andyrepton' });
    for (const w of writes) {
      const meta = (w.body as any).metadata;
      expect(meta.annotations['devspaces-self-service/requested-by']).toBe(
        'user:default/andyrepton',
      );
    }
  });

  it('applies rather than creates, so re-submitting converges instead of 409ing', async () => {
    const { kube, writes } = fakeKube();
    await provision({ kube, request, capabilities, userEntityRef: 'user:default/andyrepton' });
    expect(writes.every(w => w.path.length > 0)).toBe(true);
    // Server-side apply is a PATCH with a fieldManager, not a POST.
    expect(writes.every(w => w.method === 'PATCH')).toBe(true);
  });

  it('adopts a namespace Dev Spaces already made for the same user', async () => {
    const { kube } = fakeKube({
      '/api/v1/namespaces/andyrepton-devspaces': {
        metadata: {
          labels: { 'app.kubernetes.io/part-of': 'che.eclipse.org' },
          annotations: { 'che.eclipse.org/username': 'andyrepton' },
        },
      },
    });
    const result = await provision({
      kube,
      request,
      capabilities,
      userEntityRef: 'user:default/andyrepton',
    });
    expect(result.applied[0]?.created).toBe(false);
  });

  it("refuses a namespace that belongs to something else", async () => {
    const { kube, writes } = fakeKube({
      '/api/v1/namespaces/andyrepton-devspaces': {
        metadata: { labels: { 'app.kubernetes.io/managed-by': 'some-other-team' } },
      },
    });
    await expect(
      provision({ kube, request, capabilities, userEntityRef: 'user:default/andyrepton' }),
    ).rejects.toThrow(RefusedError);
    expect(writes).toHaveLength(0);
  });

  it('turns a 403 into advice rather than a bare permission error', async () => {
    const kube = new KubeClient({
      request: async (method, path) => {
        if (method === 'GET') return { status: 404, body: {} };
        void path;
        return { status: 403, body: { message: 'namespaces is forbidden' } };
      },
    });
    await expect(
      provision({ kube, request, capabilities, userEntityRef: 'user:default/andyrepton' }),
    ).rejects.toThrow(/rbac\/provisioner\.yaml/);
  });

  it('writes the secret last, so a failure leaves no credential behind', async () => {
    const { kube, writes } = fakeKube();
    await provision({
      kube,
      request: {
        ...request,
        ai: { kind: 'third-party', baseUrl: 'https://api.example.com/v1', apiKey: 'sk-secret' },
      },
      capabilities,
      userEntityRef: 'user:default/andyrepton',
    });
    expect(writes[writes.length - 1]?.path).toMatch(/secrets\/devspaces-ai-credentials$/);
  });
});

describe('the router refuses by default', () => {
  it('has no header-based identity fallback', async () => {
    // Regression guard. An earlier version trusted
    // x-backstage-user-entity-ref, which any client can set - so anyone able
    // to reach the endpoint could claim to be anyone and have a namespace
    // created in their name. Identity now comes only from verified
    // credentials supplied by the plugin.
    const express = (await import('express')).default;
    const request = (await import('supertest')).default;
    const { createRouter } = await import('../src/router');

    const app = express();
    app.use('/api/devspaces-self-service', createRouter({ kube: fakeKube().kube }));

    const res = await request(app)
      .post('/api/devspaces-self-service/provision')
      .set('x-backstage-user-entity-ref', 'user:default/somebody-else')
      .send({ totalVcpu: 2, totalRamGiB: 4, storageGiB: 10 });

    expect(res.status).toBe(401);
  });

  it('refuses a guest even when one is supplied', async () => {
    const express = (await import('express')).default;
    const request = (await import('supertest')).default;
    const { createRouter } = await import('../src/router');

    const app = express();
    app.use(
      '/api/devspaces-self-service',
      createRouter({
        kube: fakeKube().kube,
        identify: async () => 'user:development/guest',
      }),
    );

    const res = await request(app)
      .post('/api/devspaces-self-service/provision')
      .send({ totalVcpu: 2, totalRamGiB: 4, storageGiB: 10 });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Guest sign-in cannot provision/);
  });
});
