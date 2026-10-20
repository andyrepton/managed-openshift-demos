import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, { type Request, type Response, type Router } from 'express';
import { z } from 'zod';

import {
  type AroFlavour,
  type ClusterPlan,
  type EndpointRequest,
  type PriceTable,
  type PricingOverrides,
  type SizingRequest,
  type Sku,
  type WorkloadProfile,
  categoriesForProfile,
  estimateCost,
  findSkus,
  getSku,
  inferProfile,
  planNetworkPolicies,
  recommendNodePools,
} from '@aro-planner/common';

import { ARO_DOCS, lookupDocs } from './docs.js';

/**
 * How the tools get prices.
 *
 * Injected rather than calling `buildPriceTable` directly so the MCP tools share
 * the router's TTL cache. They previously had their own path straight to Azure,
 * which meant an assistant sweeping a range of sizes issued one live request per
 * call and hit the endpoint's 429 rate limit - while the wizard, asking the same
 * questions, was served from cache.
 */
export type PriceLoader = (skus: Sku[], region: string) => Promise<PriceTable>;

/**
 * MCP tools over the planner.
 *
 * Served from the backend plugin rather than a separate deployment: the
 * lightspeed-core sidecar runs in the same pod as backstage-backend, so it reaches
 * these at `http://localhost:7007/api/aro-planner/mcp` with no Service, no
 * NetworkPolicy and no extra image. That is the same pattern RHDH uses for its own
 * `mcp-integration-tools`.
 *
 * Every tool calls the same functions as the wizard, so the assistant and the page
 * cannot disagree about a number.
 */

const PROFILES = ['general', 'memory-heavy', 'compute-heavy', 'storage-heavy', 'gpu'] as const;

const sizingShape = {
  vcpu: z.number().positive().describe('vCPU the workload needs. Allocatable, not raw.'),
  ramGiB: z.number().positive().describe('Memory in GiB. Allocatable, not raw.'),
  region: z.string().default('westeurope').describe('Azure region, e.g. westeurope'),
  flavour: z.enum(['hcp', 'classic']).default('hcp').describe('ARO architecture'),
  profile: z.enum(PROFILES).optional().describe('Workload profile; inferred from the RAM:vCPU ratio if omitted'),
  highAvailability: z.boolean().default(true).describe('Spread nodes across three availability zones'),
  dayTwo: z.boolean().default(false).describe('Adding a pool to an existing cluster; permits day-2-only sizes'),
};

function toRequest(a: {
  vcpu: number; ramGiB: number; region: string; flavour: AroFlavour;
  profile?: WorkloadProfile; highAvailability: boolean; dayTwo: boolean;
}): SizingRequest {
  return {
    flavour: a.flavour,
    region: a.region,
    vcpu: a.vcpu,
    ramGiB: a.ramGiB,
    profile: a.profile ?? inferProfile(a.vcpu, a.ramGiB),
    highAvailability: a.highAvailability,
    dayTwo: a.dayTwo,
  };
}

const text = (v: unknown) => ({
  content: [{ type: 'text' as const, text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }],
});

export function buildMcpServer(
  overrides: Partial<PricingOverrides>,
  loadPrices: PriceLoader,
): McpServer {
  const server = new McpServer({ name: 'aro-planner', version: '0.1.0' });

  server.tool(
    'list_supported_skus',
    'List the VM sizes Microsoft supports for ARO, optionally filtered. This is the ' +
      'authoritative ARO list, which is much smaller than what Azure offers overall.',
    {
      profile: z.enum(PROFILES).optional(),
      role: z.enum(['worker', 'control-plane']).default('worker'),
      dayTwo: z.boolean().default(false).describe('Include sizes only supported as day-2 additions'),
      openshiftVersion: z.string().optional().describe('Filter out sizes needing a newer ARO'),
    },
    async a => {
      const skus = findSkus({
        role: a.role,
        ...(a.profile ? { categories: categoriesForProfile(a.profile) } : {}),
        allowDay2Only: a.dayTwo,
        ...(a.openshiftVersion ? { openshiftVersion: a.openshiftVersion } : {}),
      });
      return text({
        count: skus.length,
        skus: skus.map(s => ({ name: s.name, vcpu: s.vcpu, ramGiB: s.ramGiB, category: s.category, day2Only: s.day2Only })),
      });
    },
  );

  server.tool(
    'recommend_node_pools',
    'Recommend ARO node pools for a workload. Treats the vCPU and RAM given as ' +
      'allocatable and subtracts per-node OpenShift overhead, so the answer is what ' +
      'pods can actually request.',
    sizingShape,
    async a => {
      const req = toRequest(a);
      const candidates = findSkus({
        role: 'worker',
        categories: categoriesForProfile(req.profile),
        allowDay2Only: req.dayTwo,
      });
      const prices = await loadPrices(candidates, req.region);
      const recs = recommendNodePools(req, { prices, limit: 3 });

      if (recs.length === 0) {
        return text(`No supported ARO VM size can satisfy ${req.vcpu} vCPU / ${req.ramGiB} GiB in ${req.region}.`);
      }
      return text({
        profile: req.profile,
        options: recs.map(r => ({
          sku: r.sku.name, nodes: r.nodes,
          totalVcpu: r.totalVcpu, totalRamGiB: r.totalRamGiB,
          sparePercent: Math.round(r.waste * 100),
          hourlyVmCost: r.hourlyVmCost,
          why: r.rationale,
        })),
      });
    },
  );

  server.tool(
    'estimate_cost',
    'Price an ARO cluster for a workload, from the live Azure Retail Prices API. ' +
      'Each line states whether it came from Azure, from local configuration, or is ' +
      'an assumption. Report that provenance - never present an assumed figure as an ' +
      'Azure price.',
    { ...sizingShape, controlPlaneSku: z.string().default('Standard_D8s_v3').describe('Classic ARO only') },
    async a => {
      const req = toRequest(a);
      const candidates = findSkus({
        role: 'worker',
        categories: categoriesForProfile(req.profile),
        allowDay2Only: req.dayTwo,
      });
      const cpSku = getSku(a.controlPlaneSku, 'control-plane');
      if (req.flavour === 'classic' && !cpSku) {
        return text(`${a.controlPlaneSku} is not a supported ARO control plane size.`);
      }
      const prices = await loadPrices(cpSku ? [...candidates, cpSku] : candidates, req.region);
      const recs = recommendNodePools(req, { prices, limit: 1 });
      if (recs.length === 0) return text(`Nothing supported fits that request in ${req.region}.`);

      const plan: ClusterPlan = {
        flavour: req.flavour,
        region: req.region,
        ...(req.flavour === 'classic' && cpSku ? { controlPlaneSku: cpSku } : {}),
        workerPools: [recs[0]!],
      };
      const est = estimateCost(plan, prices, overrides);
      return text({
        nodePool: `${recs[0]!.nodes} x ${recs[0]!.sku.name}`,
        currency: est.currency,
        hourly: est.hourly, monthly: est.monthly, yearly: est.yearly,
        lines: est.lines.map(l => ({ label: l.label, hourly: l.hourly, included: l.included, source: l.source, note: l.sourceNote })),
        mustReport: est.assumptions,
      });
    },
  );

  server.tool(
    'suggest_network_policies',
    'Generate NetworkPolicies for a namespace from the connectivity a team needs. ' +
      'Returns caveats where NetworkPolicy genuinely cannot express an intent - pass ' +
      'those on rather than inventing a rule.',
    {
      namespace: z.string().describe('Target namespace'),
      endpoints: z.array(z.object({
        name: z.string(),
        direction: z.enum(['ingress', 'egress']),
        target: z.discriminatedUnion('kind', [
          z.object({ kind: z.literal('internet') }),
          z.object({ kind: z.literal('namespace'), namespace: z.string() }),
          z.object({ kind: z.literal('on-premises'), cidrs: z.array(z.string()) }),
          z.object({ kind: z.literal('azure-service'), service: z.string() }),
        ]),
        ports: z.array(z.object({ protocol: z.enum(['TCP', 'UDP']), port: z.number() })).optional(),
      })).default([]),
    },
    async a => text(planNetworkPolicies({ namespace: a.namespace, endpoints: a.endpoints as EndpointRequest[] })),
  );

  server.tool(
    'lookup_aro_doc',
    'Find official ARO documentation on a topic, from Microsoft Learn and Red Hat. ' +
      'Use this instead of recalling ARO details from memory, and cite the URLs.',
    { topic: z.string().describe('e.g. "supported vm sizes", "networking", "pricing", "upgrades"') },
    async a => {
      const hits = lookupDocs(a.topic);
      return text(hits.length > 0 ? hits : { message: 'No specific match.', allTopics: ARO_DOCS.map(d => d.topic) });
    },
  );

  return server;
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * Headers that mean a request was relayed rather than made in-pod.
 *
 * `x-forwarded-user` and `x-forwarded-email` are what the OpenShift oauth-proxy
 * sidecar adds; the rest are what any reverse proxy adds. Used only to reject.
 */
const PROXY_HEADERS = [
  'x-forwarded-for',
  'x-forwarded-user',
  'x-forwarded-email',
  'x-forwarded-host',
  'x-forwarded-proto',
  'forwarded',
] as const;

/**
 * Only the in-pod assistant may call these tools.
 *
 * `lightspeed-core` is a sidecar in this pod and reaches the router over
 * `localhost:7007`, so its TCP peer address is loopback. Anything arriving through
 * the Route has traversed the router and the Service, so it never is. That makes
 * the peer address a real discriminator - unlike an `Origin` or `Referer` header,
 * which the caller sets and can forge.
 *
 * Without this, any authenticated user - including a guest, if guest sign-in is on -
 * can drive the tools directly from the internet.
 */
function loopbackOnly(req: Request, res: Response, next: express.NextFunction): void {
  if (process.env.ARO_PLANNER_MCP_ALLOW_REMOTE === 'true') {
    next();
    return;
  }

  /*
   * `trust proxy` would make this check meaningless without changing it.
   *
   * It is off today, but if it were ever turned on, Express would start
   * believing `X-Forwarded-For` - and a caller who sets that header to
   * `127.0.0.1` would look local. The control would still be here, still
   * returning 403 to nobody, while the endpoint was open. Fail closed and say
   * why rather than let that happen quietly.
   */
  if (req.app?.get('trust proxy') ) {
    res.status(500).json({
      error:
        'The MCP endpoint is restricted by TCP peer address, which "trust proxy" ' +
        'makes forgeable. Refusing to serve until that is resolved.',
    });
    return;
  }

  /*
   * Loopback alone stopped being sufficient once an oauth-proxy sidecar went in
   * front of Backstage.
   *
   * The proxy upstreams over `http://localhost:7007`, so EVERY external request
   * now arrives with a loopback peer address. The check would have passed for
   * anyone on the internet while still looking like it was doing something.
   *
   * A proxied request is distinguishable because the proxy adds headers. This
   * uses their PRESENCE to deny, never to allow: a caller can forge a header to
   * make themselves look proxied (and be rejected), but cannot remove one the
   * proxy added. The in-pod assistant connects to the port directly and sets
   * none of these.
   */
  const proxied = PROXY_HEADERS.find(h => req.headers[h] !== undefined);
  if (proxied) {
    res.status(403).json({
      error:
        'The MCP endpoint only accepts direct in-pod callers. This request came ' +
        `through a proxy (${proxied}), so it did not originate inside the pod.`,
    });
    return;
  }

  const peer = req.socket.remoteAddress ?? '';
  if (LOOPBACK.has(peer)) {
    next();
    return;
  }
  res.status(403).json({
    error:
      'The MCP endpoint only accepts in-pod callers. It exists for the assistant ' +
      'sidecar on localhost, not for external clients.',
  });
}

/** Mount the MCP endpoint. Stateless: one server and transport per request. */
export function mcpRouter(overrides: Partial<PricingOverrides>, loadPrices: PriceLoader): Router {
  const router = express.Router();
  router.use(loopbackOnly);
  router.use(express.json({ limit: '1mb' }));

  const handle = async (req: Request, res: Response) => {
    const server = buildMcpServer(overrides, loadPrices);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  };

  router.post('/', (req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) res.status(500).json({ error: 'MCP request failed' });
    });
  });

  // Stateless mode supports POST only; be explicit rather than returning a 404 that
  // looks like the endpoint is missing.
  router.get('/', (_req, res) =>
    res.status(405).json({ error: 'This MCP endpoint is stateless; use POST.' }),
  );

  return router;
}
