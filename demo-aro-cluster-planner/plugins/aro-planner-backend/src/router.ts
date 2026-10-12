import express, { type Router } from 'express';

import {
  DEFAULT_OVERRIDES,
  type AroFlavour,
  type ClusterPlan,
  type PriceTable,
  type PricingOverrides,
  type SizingRequest,
  type Sku,
  type WorkloadProfile,
  buildPriceTable,
  categoriesForProfile,
  estimateCost,
  findSkus,
  getSku,
  inferProfile,
  recommendNodePools,
} from '@aro-planner/common';

import { TtlCache } from './cache.js';

/** Azure publishes prices rarely; an hour of staleness is not material to an estimate. */
const PRICE_TTL_MS = 60 * 60 * 1000;

export interface RouterOptions {
  overrides?: Partial<PricingOverrides>;
  /** Injectable for tests. */
  buildPrices?: typeof buildPriceTable;
  ttlMs?: number;
}

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

  return {
    flavour,
    region,
    vcpu,
    ramGiB,
    profile,
    highAvailability: b.highAvailability !== false,
    dayTwo: b.dayTwo === true,
    ...(version ? { openshiftVersion: version } : {}),
  };
}

export function createRouter(options: RouterOptions = {}): Router {
  const { overrides = {}, buildPrices = buildPriceTable, ttlMs = PRICE_TTL_MS } = options;
  const cache = new TtlCache<PriceTable>(ttlMs);
  const router = express.Router();
  router.use(express.json({ limit: '64kb' }));

  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', cachedRegions: cache.size });
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
   * The endpoint the wizard actually uses: form state in, ranked options and a
   * costed breakdown out. One round trip per change keeps the cost panel in step
   * with the form without the UI having to orchestrate several calls.
   */
  router.post('/plan', async (req, res) => {
    let request: SizingRequest;
    try {
      request = parsePlanRequest(req.body);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'invalid request' });
      return;
    }

    // Price only the plausible candidates, not all 272 supported sizes.
    const candidates = findSkus({
      role: 'worker',
      categories: categoriesForProfile(request.profile),
      allowDay2Only: request.dayTwo,
      ...(request.openshiftVersion ? { openshiftVersion: request.openshiftVersion } : {}),
    });

    const controlPlaneSkuName = String(
      (req.body as Record<string, unknown>)?.controlPlaneSku ?? 'Standard_D8s_v3',
    );
    const cpSku = getSku(controlPlaneSkuName, 'control-plane');
    if (request.flavour === 'classic' && !cpSku) {
      res.status(400).json({ error: `${controlPlaneSkuName} is not a supported ARO control plane size` });
      return;
    }

    const toPrice = cpSku ? [...candidates, cpSku] : candidates;
    const cacheKey = `${request.region}|${request.profile}|${request.dayTwo}|${request.openshiftVersion ?? 'any'}|${cpSku?.name ?? '-'}`;

    let entry;
    try {
      entry = await cache.get(cacheKey, () => buildPrices(toPrice, request.region));
    } catch (err) {
      res.status(502).json({
        error: 'Could not reach the Azure Retail Prices API and no cached prices are available.',
        detail: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    const prices: PriceTable = entry.stale ? { ...entry.value, stale: true } : entry.value;
    const recommendations = recommendNodePools(request, { prices, limit: 3 });

    if (recommendations.length === 0) {
      res.json({
        request,
        recommendations: [],
        estimate: null,
        warning: `No supported VM size can satisfy that request in ${request.region}.`,
        pricesRetrievedAt: prices.retrievedAt,
        pricesStale: prices.stale === true,
      });
      return;
    }

    const plan: ClusterPlan = {
      flavour: request.flavour,
      region: request.region,
      ...(request.flavour === 'classic' && cpSku ? { controlPlaneSku: cpSku } : {}),
      workerPools: [recommendations[0]!],
    };

    const merged: Partial<PricingOverrides> = { ...DEFAULT_OVERRIDES, ...overrides };
    res.json({
      request,
      recommendations,
      estimate: estimateCost(plan, prices, merged),
      pricesRetrievedAt: prices.retrievedAt,
      pricesStale: prices.stale === true,
    });
  });

  return router;
}
