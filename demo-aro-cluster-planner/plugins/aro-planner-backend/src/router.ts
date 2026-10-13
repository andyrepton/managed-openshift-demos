import express, { type Router } from 'express';

import {
  DEFAULT_OVERRIDES,
  type AroFlavour,
  type ClusterPlan,
  type PriceTable,
  type PricingOverrides,
  type EndpointRequest,
  type SizingRequest,
  type Sku,
  type WorkloadProfile,
  buildPriceTable,
  cheapestPriced,
  compareModels,
  categoriesForProfile,
  emitBundle,
  estimateCost,
  findSkus,
  getSku,
  inferProfile,
  planNetworkPolicies,
  planStorage,
  recommendNodePools,
} from '@aro-planner/common';

import { TtlCache } from './cache';
import { endpointsSchema } from './schema';
import { mcpRouter } from './mcp';
import { assistantRouter, type AssistantLogger } from './assistant/router';
import type { AssistantConfig } from './assistant/client';

/** Azure publishes prices rarely; an hour of staleness is not material to an estimate. */
const PRICE_TTL_MS = 60 * 60 * 1000;

export interface RouterOptions {
  overrides?: Partial<PricingOverrides>;
  /** Injectable for tests. */
  buildPrices?: typeof buildPriceTable;
  ttlMs?: number;
  /** Absent means the in-page assistant is off and says so. */
  assistant?: AssistantConfig;
  /** Backstage's logger, so a failed assistant turn leaves a trace. */
  logger?: AssistantLogger;
}

/** The assistant is off unless a model endpoint has been configured for it. */
const ASSISTANT_OFF: AssistantConfig = {
  enabled: false,
  baseUrl: '',
  apiKey: '',
  model: '',
  disabledReason: 'No model endpoint configured for the assistant.',
  timeoutMs: 120_000,
  turnTimeoutMs: 300_000,
  maxRounds: 5,
  maxTokens: 4096,
  thinking: false,
};

const PROFILES: readonly WorkloadProfile[] = [
  'general',
  'memory-heavy',
  'compute-heavy',
  'storage-heavy',
  'gpu',
];

/** Azure region names are lowercase alphanumerics; reject anything else before it reaches the API. */
const REGION_RE = /^[a-z0-9]{3,40}$/;

class BadRequest extends Error {}

function parsePlanRequest(body: unknown): SizingRequest {
  const b = (body ?? {}) as Record<string, unknown>;

  const vcpu = Number(b.vcpu);
  const ramGiB = Number(b.ramGiB);
  if (!Number.isFinite(vcpu) || vcpu <= 0) throw new BadRequest('vcpu must be a positive number');
  if (!Number.isFinite(ramGiB) || ramGiB <= 0) throw new BadRequest('ramGiB must be a positive number');
  // Guard against a typo turning into hundreds of pointless SKU queries.
  if (vcpu > 20000 || ramGiB > 200000) throw new BadRequest('vcpu/ramGiB are implausibly large');

  const region = String(b.region ?? 'westeurope');
  if (!REGION_RE.test(region)) throw new BadRequest(`region "${region}" is not a valid Azure region name`);

  const flavour = (b.flavour ?? 'hcp') as AroFlavour;
  if (flavour !== 'hcp' && flavour !== 'classic') throw new BadRequest("flavour must be 'hcp' or 'classic'");

  const profile = (b.profile as WorkloadProfile | undefined) ?? inferProfile(vcpu, ramGiB);
  if (!PROFILES.includes(profile)) throw new BadRequest(`profile must be one of: ${PROFILES.join(', ')}`);

  const version = b.openshiftVersion === undefined ? undefined : String(b.openshiftVersion);

  const storageGiB = b.storageGiB === undefined ? 0 : Number(b.storageGiB);
  if (!Number.isFinite(storageGiB) || storageGiB < 0) {
    throw new BadRequest('storageGiB must be zero or a positive number');
  }
  // 32767 GiB is the largest managed disk Azure sells; above that the planner
  // cannot honestly cost it as one volume.
  if (storageGiB > 32767) {
    throw new BadRequest('storageGiB is larger than the largest managed disk (32767 GiB)');
  }
  const tier = b.storageTier === 'standard-ssd' ? 'standard-ssd' : 'premium-ssd';

  return {
    flavour,
    region,
    vcpu,
    ramGiB,
    profile,
    highAvailability: b.highAvailability !== false,
    dayTwo: b.dayTwo === true,
    ...(typeof b.deploymentModel === 'string'
      ? { deploymentModel: b.deploymentModel as SizingRequest['deploymentModel'] }
      : {}),
    ...(typeof b.applicationName === 'string' && b.applicationName
      ? { applicationName: b.applicationName }
      : {}),
    ...(version ? { openshiftVersion: version } : {}),
    ...(storageGiB > 0 ? { storageGiB, storageTier: tier } : {}),
  };
}

export function createRouter(options: RouterOptions = {}): Router {
  const {
    overrides = {},
    buildPrices = buildPriceTable,
    ttlMs = PRICE_TTL_MS,
    assistant = ASSISTANT_OFF,
    logger,
  } = options;
  const cache = new TtlCache<PriceTable>(ttlMs);
  const router = express.Router();
  router.use(express.json({ limit: '64kb' }));

  /**
   * One cached path to Azure for everything in this plugin.
   *
   * The key is the region plus the exact set of SKUs asked for, so two callers
   * wanting the same catalogue share an entry while a different slice still gets
   * its own. Sorted, because the caller's array order is incidental.
   */
  const loadPrices = async (skus: Sku[], region: string): Promise<PriceTable> => {
    const names = skus.map(s => s.name).sort();
    const entry = await cache.get(`${region}|${names.join(',')}`, () => buildPrices(skus, region));
    return entry.stale ? { ...entry.value, stale: true } : entry.value;
  };

  // MCP tools over the same engine, and now the same price cache. The
  // lightspeed-core sidecar shares this pod, so it reaches them at
  // http://localhost:7007/api/aro-planner/mcp.
  router.use('/mcp', mcpRouter(overrides, loadPrices));

  // The in-page assistant. Unlike MCP this is called from the browser, so it is
  // reachable through the Route - and therefore off until a model endpoint is
  // configured. See assistant/config.ts.
  router.use('/assistant', assistantRouter(assistant, overrides, loadPrices, logger));

  router.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      cachedRegions: cache.size,
      assistant: assistant.enabled ? 'enabled' : 'disabled',
    });
  });

  /** The supported VM size catalogue, optionally filtered. Static - no Azure call. */
  router.get('/skus', (req, res) => {
    const profile = req.query.profile as WorkloadProfile | undefined;
    if (profile && !PROFILES.includes(profile)) {
      res.status(400).json({ error: `profile must be one of: ${PROFILES.join(', ')}` });
      return;
    }
    const version = req.query.openshiftVersion;
    res.json({
      skus: findSkus({
        role: (req.query.role as Sku['role']) ?? 'worker',
        ...(profile ? { categories: categoriesForProfile(profile) } : {}),
        allowDay2Only: req.query.dayTwo === 'true',
        ...(typeof version === 'string' && version ? { openshiftVersion: version } : {}),
      }),
    });
  });

  /**
   * Everything a request implies, computed once.
   *
   * Shared by /plan and /artifacts so the files that get published are generated
   * from the same numbers the page showed, not a recomputation that could drift.
   * Returns a failure rather than throwing, because the two callers report it
   * differently.
   */
  type PlanFailure = { ok: false; status: number; body: Record<string, unknown> };
  type PlanSuccess = {
    ok: true;
    request: SizingRequest;
    prices: PriceTable;
    recommendations: ReturnType<typeof recommendNodePools>;
    plan: ClusterPlan;
    comparison: ReturnType<typeof compareModels>;
    /** The pool the costing used - the selected one, or the cheapest. */
    chosenPool: ReturnType<typeof recommendNodePools>[number];
    networkPlan: ReturnType<typeof planNetworkPolicies>;
    cpSku: Sku | undefined;
    merged: Partial<PricingOverrides>;
  };

  const buildPlan = async (body: unknown): Promise<PlanSuccess | PlanFailure> => {
    let request: SizingRequest;
    try {
      request = parsePlanRequest(body);
    } catch (err) {
      return {
        ok: false,
        status: 400,
        body: { error: err instanceof Error ? err.message : 'invalid request' },
      };
    }

    // Price only the plausible candidates, not all 272 supported sizes.
    const candidates = findSkus({
      role: 'worker',
      categories: categoriesForProfile(request.profile),
      allowDay2Only: request.dayTwo,
      ...(request.openshiftVersion ? { openshiftVersion: request.openshiftVersion } : {}),
    });

    const controlPlaneSkuName = String(
      (body as Record<string, unknown>)?.controlPlaneSku ?? 'Standard_D8s_v3',
    );
    const cpSku = getSku(controlPlaneSkuName, 'control-plane');
    if (request.flavour === 'classic' && !cpSku) {
      return {
        ok: false,
        status: 400,
        body: { error: `${controlPlaneSkuName} is not a supported ARO control plane size` },
      };
    }

    const parsedEndpoints = endpointsSchema.safeParse(
      (body as Record<string, unknown>)?.endpoints ?? [],
    );
    if (!parsedEndpoints.success) {
      return {
        ok: false,
        status: 400,
        body: {
          error: 'Invalid endpoints',
          detail: parsedEndpoints.error.issues
            .map(i => `${i.path.join('.') || 'endpoints'}: ${i.message}`)
            .join('; '),
        },
      };
    }

    let prices: PriceTable;
    try {
      prices = await loadPrices(cpSku ? [...candidates, cpSku] : candidates, request.region);
    } catch (err) {
      return {
        ok: false,
        status: 502,
        body: {
          error: 'Could not reach the Azure Retail Prices API and no cached prices are available.',
          detail: err instanceof Error ? err.message : String(err),
        },
      };
    }

    const recommendations = recommendNodePools(request, { prices, limit: 3 });
    if (recommendations.length === 0) {
      return {
        ok: false,
        status: 200,
        body: {
          request,
          recommendations: [],
          estimate: null,
          warning: `No supported VM size can satisfy that request in ${request.region}.`,
          pricesRetrievedAt: prices.retrievedAt,
          pricesStale: prices.stale === true,
        },
      };
    }

    // Honour a chosen node pool. The cards in the UI were previously inert
    // because the costing always took recommendations[0]; selecting one has to
    // move the price or it is worse than not offering the choice.
    const wanted = (body as Record<string, unknown>)?.nodePoolSku;
    const chosenPool =
      (typeof wanted === 'string'
        ? recommendations.find(r => r.sku.name === wanted)
        : undefined) ?? recommendations[0]!;

    const storage = request.storageGiB
      ? planStorage(request.storageGiB, request.storageTier ?? 'premium-ssd')
      : null;

    const plan: ClusterPlan = {
      flavour: request.flavour,
      region: request.region,
      ...(request.flavour === 'classic' && cpSku ? { controlPlaneSku: cpSku } : {}),
      workerPools: [chosenPool],
      ...(storage ? { storage } : {}),
    };

    // Connectivity -> NetworkPolicies. Namespace defaults to the application name
    // so the generated manifests are usable as-is.
    const networkPlan = planNetworkPolicies({
      namespace: request.applicationName || 'my-application',
      endpoints: parsedEndpoints.data as EndpointRequest[],
    });

    const merged: Partial<PricingOverrides> = { ...DEFAULT_OVERRIDES, ...overrides };
    const comparison = compareModels(request, {
      prices,
      dedicated: { plan, pool: chosenPool, ...(cpSku ? { controlPlaneSku: cpSku } : {}) },
      overrides: merged,
    });

    return {
      ok: true, request, prices, recommendations, plan, comparison, networkPlan,
      cpSku, merged, chosenPool,
    };
  };

  /**
   * The endpoint the wizard actually uses: form state in, ranked options and a
   * costed breakdown out. One round trip per change keeps the cost panel in step
   * with the form without the UI having to orchestrate several calls.
   */
  router.post('/plan', async (req, res) => {
    try {
      const built = await buildPlan(req.body);
      if (!built.ok) {
        res.status(built.status).json(built.body);
        return;
      }
      const { request, prices, recommendations, plan, comparison, networkPlan, merged } = built;

      res.json({
        request,
        recommendations,
        selectedSku: built.chosenPool.sku.name,
        estimate: estimateCost(plan, prices, merged),
        comparison,
        cheapest: cheapestPriced(comparison)?.model ?? null,
        networkPlan,
        pricesRetrievedAt: prices.retrievedAt,
        pricesStale: prices.stale === true,
      });
    } catch (err) {
      // Express 4 does not catch throws from an async handler - without this the
      // socket stays open and the client waits for its own timeout.
      if (!res.headersSent) {
        res.status(500).json({
          error: 'Could not build a plan.',
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    }
  });

  /**
   * The files this request would produce: plan.md, the namespace manifests and,
   * for a dedicated cluster, a tfvars.
   *
   * Generated from the same computed plan as /plan, so the preview is the
   * artifact - not an approximation of it that could disagree with the price the
   * user was just shown.
   */
  router.post('/artifacts', async (req, res) => {
    try {
      const built = await buildPlan(req.body);
      if (!built.ok) {
        res.status(built.status === 200 ? 422 : built.status).json(built.body);
        return;
      }
      const { request, prices, recommendations, plan, comparison, networkPlan } = built;

      res.json(
        emitBundle({
          request,
          plan,
          pool: built.chosenPool,
          alternatives: recommendations.filter(r => r.sku.name !== built.chosenPool.sku.name),
          comparison,
          networkPlan,
          prices: { retrievedAt: prices.retrievedAt, ...(prices.stale ? { stale: true } : {}) },
          generatedAt: new Date().toISOString().slice(0, 10),
        }),
      );
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({
          error: 'Could not generate the artifacts.',
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    }
  });

  return router;
}
