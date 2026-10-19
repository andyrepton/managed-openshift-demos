/**
 * Live availability of the approved operators, read from the cluster's OperatorHub.
 *
 * This answers one question: is the package this plan asks for actually
 * installable here, and at what version? It deliberately does NOT supply the
 * CPU/RAM figures. A PackageManifest's `currentCSVDesc` carries no deployment
 * spec, and the operand footprint - three Kafka brokers, three Keycloak pods -
 * lives in a CR that does not exist until someone creates it. Those numbers are
 * curated in `operators.ts` and cannot come from this API.
 *
 * This is the only part of the planner that talks to Kubernetes. It lives in
 * the backend plugin rather than `@aro-planner/common` because common is
 * bundled wholesale into the browser, and a cluster token has no business
 * there.
 *
 * Everything degrades to `unknown` rather than failing. The CLI, the tests and
 * a local dev server have no ServiceAccount token, and a planner that refused
 * to price a cluster because it could not reach OperatorHub would be worse than
 * one that says "could not check".
 */

import { readFile } from 'fs/promises';
import * as https from 'https';

import { OPERATOR_CATALOG, type OperatorId } from '@aro-planner/common';

import { TtlCache } from './cache';

const SA_DIR = '/var/run/secrets/kubernetes.io/serviceaccount';
const TOKEN_PATH = `${SA_DIR}/token`;
const CA_PATH = `${SA_DIR}/ca.crt`;

/** Catalog contents change when a catalog source resyncs, hourly by default. */
const CATALOG_TTL_MS = 15 * 60 * 1000;

/** A slow API server must not hold up an estimate. */
const REQUEST_TIMEOUT_MS = 5000;

export type OperatorAvailability = 'available' | 'missing' | 'unknown';

export interface OperatorStatus {
  id: OperatorId;
  packageName: string;
  /** Whether the package is in a catalog on this cluster. */
  availability: OperatorAvailability;
  /** Catalog source actually serving it, which may differ from the curated one. */
  catalog?: string;
  /** `currentCSVDesc.version` of the default channel. */
  version?: string;
  /** Set when availability is 'unknown': why the check could not be made. */
  reason?: string;
}

/** Just enough of a response to decide what to do with it. */
export interface JsonResponse {
  status: number;
  body: unknown;
}

export type RequestJson = (url: string, token: string) => Promise<JsonResponse>;

export interface OperatorHubOptions {
  /** Override for tests. Defaults to the in-cluster API server. */
  baseUrl?: string;
  /** Override for tests. Defaults to reading the projected ServiceAccount token. */
  readToken?: () => Promise<string>;
  /** Override for tests. Defaults to an HTTPS call pinned to the cluster CA. */
  requestJson?: RequestJson;
  ttlMs?: number;
  namespace?: string;
}

interface PackageManifestList {
  items?: {
    metadata?: { name?: string };
    status?: {
      catalogSource?: string;
      defaultChannel?: string;
      channels?: { name?: string; currentCSVDesc?: { version?: string } }[];
    };
  }[];
}

async function defaultReadToken(): Promise<string> {
  return (await readFile(TOKEN_PATH, 'utf8')).trim();
}

/**
 * GET some JSON from the API server.
 *
 * `node:https` rather than `fetch`, because the API server's certificate is
 * signed by the cluster CA and fetch gives no way to add one per request. The
 * alternative is NODE_EXTRA_CA_CERTS on the whole process, which would change
 * TLS trust for every other plugin in the pod to make one call work.
 */
const defaultRequestJson: RequestJson = async (url, token) =>
  new Promise((resolve, reject) => {
    void (async () => {
      let ca: Buffer | undefined;
      try {
        ca = await readFile(CA_PATH);
      } catch {
        // Fall through to the default trust store. If that cannot verify the
        // API server the request fails and the caller reports 'unknown'.
      }

      const req = https.request(
        url,
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
          timeout: REQUEST_TIMEOUT_MS,
          ...(ca ? { ca } : {}),
        },
        res => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            const status = res.statusCode ?? 0;
            // A non-2xx body is usually a Status object, and not worth parsing.
            if (status < 200 || status >= 300) {
              resolve({ status, body: undefined });
              return;
            }
            try {
              resolve({ status, body: JSON.parse(text) });
            } catch {
              reject(new Error('OperatorHub returned a body that is not JSON'));
            }
          });
        },
      );

      req.on('timeout', () => req.destroy(new Error(`timed out after ${REQUEST_TIMEOUT_MS}ms`)));
      req.on('error', reject);
      req.end();
    })().catch(reject);
  });

function apiServerUrl(): string {
  const host = process.env.KUBERNETES_SERVICE_HOST;
  const port = process.env.KUBERNETES_SERVICE_PORT_HTTPS ?? '443';
  // An IPv6 literal has to be bracketed or the URL is unparseable.
  const authority = host?.includes(':') ? `[${host}]` : host;
  return `https://${authority ?? 'kubernetes.default.svc'}:${port}`;
}

/** Every operator reported as unknown, for when the cluster cannot be reached. */
function allUnknown(reason: string): OperatorStatus[] {
  return OPERATOR_CATALOG.map(o => ({
    id: o.id,
    packageName: o.packageName,
    availability: 'unknown' as const,
    reason,
  }));
}

export class OperatorHubClient {
  private readonly cache: TtlCache<OperatorStatus[]>;
  private readonly namespace: string;

  constructor(private readonly options: OperatorHubOptions = {}) {
    this.cache = new TtlCache<OperatorStatus[]>(options.ttlMs ?? CATALOG_TTL_MS);
    this.namespace = options.namespace ?? 'openshift-marketplace';
  }

  /**
   * Status of every approved operator.
   *
   * One list call rather than one per package. The per-package endpoint 404s
   * for a package that exists but is not readable, which is indistinguishable
   * from one that is genuinely absent - and "missing" and "not permitted" must
   * not look the same to someone deciding what to request.
   */
  async statuses(): Promise<OperatorStatus[]> {
    const entry = await this.cache.get('all', () => this.load());
    return entry.value;
  }

  private async load(): Promise<OperatorStatus[]> {
    let token: string;
    try {
      token = await (this.options.readToken ?? defaultReadToken)();
    } catch {
      // No token mounted. The normal case off-cluster, so not an error.
      return allUnknown('no ServiceAccount token is mounted, so OperatorHub was not queried');
    }

    const base = this.options.baseUrl ?? apiServerUrl();
    const url =
      `${base}/apis/packages.operators.coreos.com/v1/namespaces/` +
      `${this.namespace}/packagemanifests`;

    let res: JsonResponse;
    try {
      res = await (this.options.requestJson ?? defaultRequestJson)(url, token);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return allUnknown(`OperatorHub could not be reached: ${message}`);
    }

    if (res.status === 401 || res.status === 403) {
      return allUnknown(
        `the ServiceAccount may not list packagemanifests in ${this.namespace} - ` +
          'grant it the aro-planner-operator-catalog-reader role',
      );
    }
    if (res.status < 200 || res.status >= 300) {
      return allUnknown(`OperatorHub returned HTTP ${res.status}`);
    }

    const list = (res.body ?? {}) as PackageManifestList;
    const found = new Map<string, { catalog?: string; version?: string }>();
    for (const item of list.items ?? []) {
      const name = item.metadata?.name;
      if (!name) continue;
      const channels = item.status?.channels ?? [];
      const preferred = channels.find(c => c.name === item.status?.defaultChannel) ?? channels[0];
      found.set(name, {
        ...(item.status?.catalogSource ? { catalog: item.status.catalogSource } : {}),
        ...(preferred?.currentCSVDesc?.version
          ? { version: preferred.currentCSVDesc.version }
          : {}),
      });
    }

    return OPERATOR_CATALOG.map(o => {
      const hit = found.get(o.packageName);
      if (!hit) {
        return { id: o.id, packageName: o.packageName, availability: 'missing' as const };
      }
      return { id: o.id, packageName: o.packageName, availability: 'available' as const, ...hit };
    });
  }
}
