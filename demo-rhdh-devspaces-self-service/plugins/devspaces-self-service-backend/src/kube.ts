/**
 * A very small Kubernetes client.
 *
 * `node:https` rather than `fetch`, because the API server's certificate is
 * signed by the cluster CA and fetch offers no way to add one per request.
 * The alternative is NODE_EXTRA_CA_CERTS on the whole process, which changes
 * TLS trust for every other plugin in the RHDH pod to make one call work.
 *
 * Deliberately not a generic client library. This plugin creates four kinds of
 * object in one namespace shape; a dependency that can do anything to anything
 * is a worse fit for something holding a namespace-creating token than ninety
 * lines we can read.
 */

import { readFile } from 'fs/promises';
import * as https from 'https';

/**
 * Where the credential lives.
 *
 * The pod's own ServiceAccount by default - but this plugin deliberately does
 * NOT use that one. RHDH runs as `default`, shared by every plugin in the
 * pod, and giving `default` the right to create namespaces would hand that
 * right to all of them. Instead a dedicated ServiceAccount's token is mounted
 * at a second path and named in app-config, so the namespace-creating
 * credential belongs to this plugin alone.
 */
export const DEFAULT_SA_DIR = '/var/run/secrets/kubernetes.io/serviceaccount';
const REQUEST_TIMEOUT_MS = 10_000;

export class KubeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'KubeError';
  }
}

/** Raised when there is no credential at all, which is the off-cluster case. */
export class NoCredentialError extends Error {}

export interface KubeResponse {
  status: number;
  body: unknown;
}

export type KubeRequester = (
  method: string,
  path: string,
  body?: unknown,
  contentType?: string,
) => Promise<KubeResponse>;

function apiServerUrl(): string {
  const host = process.env.KUBERNETES_SERVICE_HOST;
  const port = process.env.KUBERNETES_SERVICE_PORT_HTTPS ?? '443';
  const authority = host?.includes(':') ? `[${host}]` : host;
  return `https://${authority ?? 'kubernetes.default.svc'}:${port}`;
}

export interface KubeClientOptions {
  baseUrl?: string;
  readToken?: () => Promise<string>;
  /** Injectable for tests; defaults to a real HTTPS call. */
  request?: KubeRequester;
  /**
   * Directory holding `token` and optionally `ca.crt`.
   *
   * Defaults to the pod's own ServiceAccount. Point it at the mounted
   * provisioner credential instead - see rbac/provisioner.yaml.
   */
  credentialDir?: string;
}

export class KubeClient {
  private readonly baseUrl: string;
  private readonly credentialDir: string;
  private tokenPromise?: Promise<string>;

  constructor(private readonly options: KubeClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? apiServerUrl();
    this.credentialDir = options.credentialDir ?? DEFAULT_SA_DIR;
  }

  private async token(): Promise<string> {
    // The projected token is rotated, but it is valid for an hour at minimum
    // and every call here is short-lived, so reading it once per process is
    // enough and avoids a file read per request.
    this.tokenPromise ??= (this.options.readToken ?? (() => readTokenFrom(this.credentialDir)))();
    try {
      return await this.tokenPromise;
    } catch (err) {
      this.tokenPromise = undefined;
      throw new NoCredentialError(
        `no ServiceAccount token available: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async request(
    method: string,
    path: string,
    body?: unknown,
    contentType?: string,
  ): Promise<KubeResponse> {
    if (this.options.request) return this.options.request(method, path, body, contentType);
    return rawRequest(
      this.baseUrl + path,
      method,
      await this.token(),
      this.credentialDir,
      body,
      contentType,
    );
  }

  async get(path: string): Promise<KubeResponse> {
    return this.request('GET', path);
  }

  /**
   * Create, or update if it is already there.
   *
   * Server-side apply rather than POST-then-PATCH: re-running a request must
   * converge rather than fail on the second attempt, and a user who adjusts
   * their quota and submits again should get the new quota, not a 409.
   *
   * `force=true` takes ownership of fields another manager set. Without it,
   * a field Che has since written blocks the apply with a conflict that no
   * user can act on.
   */
  async apply(
    path: string,
    manifest: object | string,
    fieldManager = 'devspaces-self-service',
  ) {
    const sep = path.includes('?') ? '&' : '?';
    const url = `${path}${sep}fieldManager=${fieldManager}&force=true`;
    return this.request('PATCH', url, manifest, 'application/apply-patch+yaml');
  }
}

async function readTokenFrom(dir: string): Promise<string> {
  return (await readFile(`${dir}/token`, 'utf8')).trim();
}

function rawRequest(
  url: string,
  method: string,
  token: string,
  credentialDir: string,
  body?: unknown,
  contentType = 'application/json',
): Promise<KubeResponse> {
  return new Promise((resolve, reject) => {
    void (async () => {
      let ca: Buffer | undefined;
      try {
        // A mounted service-account-token Secret carries its own ca.crt. Fall
        // back to the pod's, which is the same cluster CA either way.
        ca = await readFile(`${credentialDir}/ca.crt`).catch(
          () => readFile(`${DEFAULT_SA_DIR}/ca.crt`),
        );
      } catch {
        // Fall back to the default trust store; if it cannot verify the API
        // server the request fails below rather than silently skipping TLS.
      }

      // A string body is sent verbatim. Server-side apply takes YAML, and the
      // editor definition is copied straight out of a ConfigMap - round-tripping
      // it through a parser would mean adding one, and would risk changing it.
      const payload =
        body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
      const req = https.request(
        url,
        {
          method,
          timeout: REQUEST_TIMEOUT_MS,
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
            ...(payload
              ? { 'Content-Type': contentType, 'Content-Length': Buffer.byteLength(payload) }
              : {}),
          },
          ...(ca ? { ca } : {}),
        },
        res => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            const status = res.statusCode ?? 0;
            let parsed: unknown;
            try {
              parsed = text ? JSON.parse(text) : undefined;
            } catch {
              parsed = text;
            }
            resolve({ status, body: parsed });
          });
        },
      );

      req.on('timeout', () => req.destroy(new Error(`timed out after ${REQUEST_TIMEOUT_MS}ms`)));
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    })().catch(reject);
  });
}

/** Turn a non-2xx response into an error carrying the API server's reason. */
export function assertOk(res: KubeResponse, what: string): void {
  if (res.status >= 200 && res.status < 300) return;
  const body = res.body as { message?: string; reason?: string } | undefined;
  throw new KubeError(
    `${what} failed: HTTP ${res.status}${body?.message ? ` - ${body.message}` : ''}`,
    res.status,
    res.body,
  );
}
