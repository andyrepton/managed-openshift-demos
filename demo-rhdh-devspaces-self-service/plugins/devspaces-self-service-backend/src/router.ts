import express, { type Router } from 'express';

import { readCapabilities, type Capabilities } from './capabilities';
import {
  assertProvisioner,
  GuestNotAllowedError,
  NotAuthenticatedError,
  usernameFromRef,
} from './identity';
import { KubeClient, NoCredentialError } from './kube';
import { SizingError } from './sizing';
import { planRequest } from './plan';
import { provision, RefusedError } from './provision';
import type { AiBackend, DevSpaceRequest } from './types';

/** Capabilities change only when an image is rebuilt. */
const CAPABILITY_TTL_MS = 5 * 60 * 1000;

export interface RouterOptions {
  kube?: KubeClient;
  /** Directory holding the provisioner's token. See rbac/provisioner.yaml. */
  credentialDir?: string;
  inClusterAiBaseUrl?: string;
  devfileRepoUrl?: string;
  devfilePath?: string;
  /**
   * Resolves the caller's Backstage entity ref from verified credentials.
   *
   * Supplied by plugin.ts in production and by tests otherwise. Absent means
   * nobody is authenticated, which is a refusal rather than an anonymous allow.
   */
  identify?: (req: express.Request) => Promise<string | undefined>;
  logger?: { info: (m: string) => void; warn: (m: string) => void };
}

class BadRequest extends Error {}

function parseAi(raw: unknown): AiBackend {
  const b = (raw ?? {}) as Record<string, unknown>;
  const kind = b.kind;
  if (kind !== 'none' && kind !== 'in-cluster' && kind !== 'third-party') {
    throw new BadRequest("ai.kind must be 'none', 'in-cluster' or 'third-party'");
  }
  if (kind !== 'third-party') {
    return { kind, ...(typeof b.model === 'string' && b.model ? { model: b.model } : {}) };
  }

  const baseUrl = String(b.baseUrl ?? '').trim();
  const apiKey = String(b.apiKey ?? '');
  if (!baseUrl) throw new BadRequest('a third-party AI endpoint needs a baseUrl');
  // Plaintext http would put the key on the wire in clear. The planner's
  // assistant refuses the same way, for the same reason.
  if (!baseUrl.startsWith('https://')) {
    throw new BadRequest('the AI baseUrl must be https - an API key must not travel in clear');
  }
  if (!apiKey) throw new BadRequest('a third-party AI endpoint needs an API key');

  return {
    kind,
    baseUrl,
    apiKey,
    ...(typeof b.model === 'string' && b.model ? { model: b.model } : {}),
  };
}

function parseRequest(body: unknown, username: string): DevSpaceRequest {
  const b = (body ?? {}) as Record<string, unknown>;

  const workspaceCount = Number(b.workspaceCount ?? 1);
  const totalVcpu = Number(b.totalVcpu);
  const totalRamGiB = Number(b.totalRamGiB);
  const storageMode = b.storageMode === 'ephemeral' ? 'ephemeral' : 'persistent';
  const storageGiB = Number(b.storageGiB ?? 0);

  if (!Number.isFinite(totalVcpu) || !Number.isFinite(totalRamGiB)) {
    throw new BadRequest('totalVcpu and totalRamGiB are required numbers');
  }
  if (!Array.isArray(b.agents ?? [])) throw new BadRequest('agents must be an array');

  const repoUrl = typeof b.repoUrl === 'string' ? b.repoUrl.trim() : '';
  if (repoUrl && !/^https:\/\//.test(repoUrl)) {
    throw new BadRequest('repoUrl must be an https URL');
  }

  return {
    // Always the caller. A username in the body would let anyone provision
    // a namespace in someone else's name.
    username,
    workspaceCount,
    totalVcpu,
    totalRamGiB,
    storageMode,
    storageGiB,
    agents: ((b.agents as unknown[]) ?? []).map(String),
    ai: parseAi(b.ai),
    ...(repoUrl ? { repoUrl } : {}),
  };
}

/**
 * No identity unless one was supplied.
 *
 * Deliberately not a fallback that reads a header. An earlier version of this
 * trusted `x-backstage-user-entity-ref`, which any client can set - so anyone
 * able to reach the endpoint could have claimed to be anyone and had a
 * namespace created in their name. Identity has to come from Backstage's
 * verified credentials, which plugin.ts supplies via httpAuth and userInfo.
 *
 * Returning undefined is a refusal: assertProvisioner turns it into a 401.
 */
async function noIdentity(): Promise<string | undefined> {
  return undefined;
}

function statusFor(err: unknown): number {
  if (err instanceof BadRequest || err instanceof SizingError) return 400;
  if (err instanceof NotAuthenticatedError) return 401;
  if (err instanceof GuestNotAllowedError) return 403;
  if (err instanceof RefusedError) return 409;
  if (err instanceof NoCredentialError) return 503;
  return 500;
}

export function createRouter(options: RouterOptions = {}): Router {
  const kube =
    options.kube ??
    new KubeClient(options.credentialDir ? { credentialDir: options.credentialDir } : {});
  const identify = options.identify ?? noIdentity;
  const router = express.Router();
  router.use(express.json({ limit: '64kb' }));

  let cached: { at: number; value: Capabilities } | undefined;
  const capabilities = async (): Promise<Capabilities> => {
    if (cached && Date.now() - cached.at < CAPABILITY_TTL_MS) return cached.value;
    const value = await readCapabilities({
      kube,
      ...(options.inClusterAiBaseUrl ? { inClusterAiBaseUrl: options.inClusterAiBaseUrl } : {}),
    });
    cached = { at: Date.now(), value };
    return value;
  };

  router.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  /** What this cluster can offer. Drives the form; never invented client-side. */
  router.get('/capabilities', async (_req, res) => {
    try {
      res.json(await capabilities());
    } catch (err) {
      res.status(statusFor(err)).json({ error: message(err) });
    }
  });

  /**
   * Everything a request implies, without touching the cluster.
   *
   * Deliberately available to any signed-in user: showing someone what their
   * request would cost in quota is not a privileged act, and making the
   * preview privileged would mean the only way to find out was to provision.
   */
  router.post('/plan', async (req, res) => {
    try {
      const ref = await identify(req);
      const username = ref ? usernameFromRef(ref) : 'preview';
      const request = parseRequest(req.body, username);
      res.json(planRequest({ request, capabilities: await capabilities(), ...devfileRefs() }));
    } catch (err) {
      res.status(statusFor(err)).json({ error: message(err) });
    }
  });

  /** Writes to the cluster. Signed-in, non-guest callers only. */
  router.post('/provision', async (req, res) => {
    try {
      const identity = assertProvisioner(await identify(req));
      const request = parseRequest(req.body, identity.username);
      const caps = await capabilities();

      // Planning first means a request that cannot work is refused before
      // anything is created, rather than leaving a half-built namespace.
      planRequest({ request, capabilities: caps, ...devfileRefs() });

      const result = await provision({
        kube,
        request,
        capabilities: caps,
        userEntityRef: identity.userEntityRef,
      });
      options.logger?.info(
        `provisioned ${result.namespace} for ${identity.userEntityRef}: ` +
          result.applied.map(a => `${a.kind}/${a.name}`).join(', '),
      );
      res.json(result);
    } catch (err) {
      options.logger?.warn(`provision refused: ${message(err)}`);
      res.status(statusFor(err)).json({ error: message(err) });
    }
  });

  function devfileRefs() {
    return {
      ...(options.devfileRepoUrl ? { devfileRepoUrl: options.devfileRepoUrl } : {}),
      ...(options.devfilePath ? { devfilePath: options.devfilePath } : {}),
    };
  }

  return router;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
