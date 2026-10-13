import {
  type ClusterPlan,
  type EndpointRequest,
  type PriceTable,
  type PricingOverrides,
  type SizingRequest,
  type Sku,
  type WorkloadProfile,
  categoriesForProfile,
  cheapestPriced,
  compareModels,
  estimateCost,
  findSkus,
  getSku,
  inferProfile,
  planNetworkPolicies,
  planStorage,
  recommendNodePools,
  storageClassFor,
  STORAGE_TIER_LABEL,
} from '@aro-planner/common';

import { ARO_DOCS, lookupDocs } from '../docs';
import type { FormAction, PlannerState } from './state';

/**
 * Tools the assistant can call.
 *
 * Two kinds, and the split is the point of C7:
 *
 *   READ-ONLY  answer a question, by running the same engine functions the wizard
 *              runs. These are the MCP tools, re-expressed in OpenAI's function
 *              schema - same implementations, so the assistant and the page
 *              cannot disagree about a number.
 *
 *   ACTION     change the form. These do not touch a server; they return a patch
 *              that the browser applies. Executing one also updates the working
 *              copy of the state, so a follow-up `estimate_cost` in the same turn
 *              prices what was just set rather than what the user last typed.
 */

export type PriceLoader = (skus: Sku[], region: string) => Promise<PriceTable>;

export interface ToolContext {
  state: PlannerState;
  overrides: Partial<PricingOverrides>;
  loadPrices: PriceLoader;
}

export interface JsonSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: JsonSchema;
  /** Action tools return a patch; read-only tools return null. */
  run: (
    args: Record<string, unknown>,
    ctx: ToolContext,
  ) => Promise<{ result: unknown; action?: FormAction }>;
}

const num = (d: string) => ({ type: 'number', description: d });
const str = (d: string) => ({ type: 'string', description: d });

function toSizingRequest(s: PlannerState): SizingRequest {
  return {
    flavour: s.flavour,
    region: s.region,
    vcpu: s.vcpu,
    ramGiB: s.ramGiB,
    profile: (s.profile as WorkloadProfile | undefined) ?? inferProfile(s.vcpu, s.ramGiB),
    highAvailability: s.highAvailability,
    dayTwo: s.dayTwo,
    deploymentModel: s.deploymentModel,
    ...(s.applicationName ? { applicationName: s.applicationName } : {}),
    ...(s.storageGiB > 0 ? { storageGiB: s.storageGiB, storageTier: s.storageTier } : {}),
  };
}

async function priceFor(ctx: ToolContext, req: SizingRequest, cpSku?: Sku) {
  const candidates = findSkus({
    role: 'worker',
    categories: categoriesForProfile(req.profile),
    allowDay2Only: req.dayTwo,
  });
  const prices = await ctx.loadPrices(cpSku ? [...candidates, cpSku] : candidates, req.region);
  return { candidates, prices };
}

// ---------------------------------------------------------------------------
// Read-only
// ---------------------------------------------------------------------------

const recommendNodePoolsTool: ToolDef = {
  name: 'recommend_node_pools',
  description:
    'Recommend ARO node pools for the capacity currently in the form. Treats vCPU ' +
    'and RAM as allocatable and accounts for per-node OpenShift overhead, so the ' +
    'answer is what pods can actually request. Call this before claiming any ' +
    'instance type is suitable.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  run: async (_a, ctx) => {
    const req = toSizingRequest(ctx.state);
    const { prices } = await priceFor(ctx, req);
    const recs = recommendNodePools(req, { prices, limit: 3 });
    if (recs.length === 0) {
      return {
        result: `No supported ARO VM size can satisfy ${req.vcpu} vCPU / ${req.ramGiB} GiB in ${req.region}.`,
      };
    }
    return {
      result: {
        profile: req.profile,
        options: recs.map(r => ({
          sku: r.sku.name,
          nodes: r.nodes,
          rawVcpu: r.totalVcpu,
          rawRamGiB: r.totalRamGiB,
          sparePercent: Math.round(r.waste * 100),
          hourlyVmCost: r.hourlyVmCost,
          why: r.rationale,
        })),
      },
    };
  },
};

const estimateCostTool: ToolDef = {
  name: 'estimate_cost',
  description:
    'Price the configuration currently in the form, from the live Azure Retail ' +
    'Prices API. Every line states whether it came from Azure, from local ' +
    'configuration, or is an assumption. You MUST pass that provenance on - never ' +
    'present an assumed figure as an Azure price.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  run: async (_a, ctx) => {
    const req = toSizingRequest(ctx.state);
    const cpSku = req.flavour === 'classic' ? getSku('Standard_D8s_v3', 'control-plane') : undefined;
    const { prices } = await priceFor(ctx, req, cpSku);
    const recs = recommendNodePools(req, { prices, limit: 1 });
    if (recs.length === 0) return { result: `Nothing supported fits that request in ${req.region}.` };

    const plan: ClusterPlan = {
      flavour: req.flavour,
      region: req.region,
      ...(cpSku ? { controlPlaneSku: cpSku } : {}),
      workerPools: [recs[0]!],
    };
    const comparison = compareModels(req, {
      prices,
      dedicated: { plan, pool: recs[0]!, ...(cpSku ? { controlPlaneSku: cpSku } : {}) },
      overrides: ctx.overrides,
    });
    const chosen = comparison.find(c => c.model === req.deploymentModel);
    const est = chosen?.estimate ?? estimateCost(plan, prices, ctx.overrides);

    return {
      result: {
        selectedModel: req.deploymentModel,
        nodePool: `${recs[0]!.nodes} x ${recs[0]!.sku.name}`,
        monthly: chosen?.amount ?? est.monthly,
        currency: est.currency,
        lines: est.lines.map(l => ({
          label: l.label,
          hourly: l.hourly,
          included: l.included,
          source: l.source,
          note: l.sourceNote,
        })),
        allModels: comparison.map(c => ({
          model: c.model,
          monthly: c.amount,
          metered: (c.estimate?.lines ?? []).some(l => l.source === 'azure-api'),
        })),
        cheapest: cheapestPriced(comparison)?.model ?? null,
        mustReport: est.assumptions,
      },
    };
  },
};

const listSupportedSkusTool: ToolDef = {
  name: 'list_supported_skus',
  description:
    'List the VM sizes Microsoft supports for ARO. This list is much smaller than ' +
    'what Azure offers overall, so check here before suggesting an instance type.',
  parameters: {
    type: 'object',
    properties: {
      profile: {
        type: 'string',
        enum: ['general', 'memory-heavy', 'compute-heavy', 'storage-heavy', 'gpu'],
        description: 'Narrow to the families matching a workload profile',
      },
    },
    additionalProperties: false,
  },
  run: async a => {
    const profile = a.profile as WorkloadProfile | undefined;
    const skus = findSkus({
      role: 'worker',
      ...(profile ? { categories: categoriesForProfile(profile) } : {}),
    });
    return {
      result: {
        count: skus.length,
        // Capped: the full catalogue is 272 entries and floods the context.
        skus: skus.slice(0, 40).map(s => ({ name: s.name, vcpu: s.vcpu, ramGiB: s.ramGiB })),
      },
    };
  },
};

const suggestNetworkPoliciesTool: ToolDef = {
  name: 'suggest_network_policies',
  description:
    'Generate the NetworkPolicies implied by the connections currently in the ' +
    'form. Returns caveats where NetworkPolicy genuinely cannot express an intent ' +
    '- pass those on rather than inventing a rule that looks right.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  run: async (_a, ctx) => {
    const plan = planNetworkPolicies({
      namespace: ctx.state.applicationName || 'my-application',
      endpoints: ctx.state.endpoints as EndpointRequest[],
    });
    return {
      result: {
        policies: plan.policies.map(p => p.metadata.name),
        caveats: plan.caveats,
        clusterSettings: plan.clusterSettings,
      },
    };
  },
};

const lookupAroDocTool: ToolDef = {
  name: 'lookup_aro_doc',
  description:
    'Find official ARO documentation on a topic, from Microsoft Learn and Red Hat. ' +
    'Use this instead of recalling ARO details from memory, and cite the URLs you ' +
    'get back.',
  parameters: {
    type: 'object',
    properties: { topic: str('e.g. "supported vm sizes", "networking", "pricing", "upgrades"') },
    required: ['topic'],
    additionalProperties: false,
  },
  run: async a => {
    const hits = lookupDocs(String(a.topic ?? ''));
    return {
      result: hits.length > 0 ? hits : { message: 'No specific match.', allTopics: ARO_DOCS.map(d => d.topic) },
    };
  },
};

// ---------------------------------------------------------------------------
// Actions - these change the form
// ---------------------------------------------------------------------------

const setCapacityTool: ToolDef = {
  name: 'set_capacity',
  description:
    'Set the vCPU and memory on the form. These are ALLOCATABLE figures - what the ' +
    "user's pods can request - not raw VM capacity. Use this when the user " +
    'describes their workload in terms you can turn into numbers.',
  parameters: {
    type: 'object',
    properties: {
      vcpu: num('Allocatable vCPU, 1 to 20000'),
      ramGiB: num('Allocatable memory in GiB, 1 to 200000'),
    },
    required: ['vcpu', 'ramGiB'],
    additionalProperties: false,
  },
  run: async (a, ctx) => {
    const vcpu = Math.round(Number(a.vcpu));
    const ramGiB = Math.round(Number(a.ramGiB));
    if (!Number.isFinite(vcpu) || vcpu < 1 || vcpu > 20000) {
      return { result: { error: 'vcpu must be between 1 and 20000' } };
    }
    if (!Number.isFinite(ramGiB) || ramGiB < 1 || ramGiB > 200000) {
      return { result: { error: 'ramGiB must be between 1 and 200000' } };
    }
    ctx.state.vcpu = vcpu;
    ctx.state.ramGiB = ramGiB;
    return {
      result: { ok: true, vcpu, ramGiB, ratio: (ramGiB / vcpu).toFixed(1) },
      action: {
        tool: 'set_capacity',
        patch: { vcpu, ramGiB },
        describe: `Set capacity to ${vcpu} vCPU / ${ramGiB} GiB`,
      },
    };
  },
};

const setDeploymentModelTool: ToolDef = {
  name: 'set_deployment_model',
  description:
    'Choose where the workload runs. Only pick on-premises if the user has a ' +
    'reason that cloud cannot meet - data residency, existing hardware, latency to ' +
    'something on-site. Price is not on its own a reason, because the ' +
    'non-Azure figures are assumptions.',
  parameters: {
    type: 'object',
    properties: {
      model: {
        type: 'string',
        enum: ['shared-namespace', 'dedicated-cluster', 'on-premises'],
      },
    },
    required: ['model'],
    additionalProperties: false,
  },
  run: async (a, ctx) => {
    const model = a.model as PlannerState['deploymentModel'];
    if (!['shared-namespace', 'dedicated-cluster', 'on-premises'].includes(model)) {
      return { result: { error: 'unknown deployment model' } };
    }
    ctx.state.deploymentModel = model;
    return {
      result: { ok: true, model },
      action: {
        tool: 'set_deployment_model',
        patch: { deploymentModel: model },
        describe: `Selected ${model.replace(/-/g, ' ')}`,
      },
    };
  },
};

const setClusterOptionsTool: ToolDef = {
  name: 'set_cluster_options',
  description:
    'Set the Azure region, the ARO architecture, or whether nodes spread across ' +
    'three availability zones. Only meaningful when the deployment model is a ' +
    'dedicated cluster. Omit anything you are not changing.',
  parameters: {
    type: 'object',
    properties: {
      region: str('Azure region name, e.g. westeurope'),
      flavour: { type: 'string', enum: ['hcp', 'classic'], description: 'ARO architecture' },
      highAvailability: { type: 'boolean', description: 'Spread across three availability zones' },
    },
    additionalProperties: false,
  },
  run: async (a, ctx) => {
    const patch: Partial<PlannerState> = {};
    const parts: string[] = [];

    if (typeof a.region === 'string') {
      if (!/^[a-z0-9]{3,40}$/.test(a.region)) {
        return { result: { error: `"${a.region}" is not a valid Azure region name` } };
      }
      patch.region = a.region;
      ctx.state.region = a.region;
      parts.push(`region ${a.region}`);
    }
    if (a.flavour === 'hcp' || a.flavour === 'classic') {
      patch.flavour = a.flavour;
      ctx.state.flavour = a.flavour;
      parts.push(a.flavour === 'hcp' ? 'hosted control planes' : 'standard architecture');
    }
    if (typeof a.highAvailability === 'boolean') {
      patch.highAvailability = a.highAvailability;
      ctx.state.highAvailability = a.highAvailability;
      parts.push(a.highAvailability ? 'three availability zones' : 'single zone');
    }
    if (parts.length === 0) return { result: { error: 'nothing to change' } };

    return {
      result: { ok: true, ...patch },
      action: { tool: 'set_cluster_options', patch, describe: `Set ${parts.join(', ')}` },
    };
  },
};

const setApplicationNameTool: ToolDef = {
  name: 'set_application_name',
  description:
    'Name the application. This becomes the namespace name, so it must be ' +
    'lower-case letters, numbers and hyphens, starting and ending alphanumeric.',
  parameters: {
    type: 'object',
    properties: { name: str('e.g. payments-api') },
    required: ['name'],
    additionalProperties: false,
  },
  run: async (a, ctx) => {
    const name = String(a.name ?? '');
    if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(name) || name.length > 50) {
      return {
        result: {
          error:
            `"${name}" is not a valid namespace name. Lower-case letters, numbers ` +
            'and hyphens only, starting and ending alphanumeric, 50 characters or fewer.',
        },
      };
    }
    ctx.state.applicationName = name;
    return {
      result: { ok: true, name },
      action: {
        tool: 'set_application_name',
        patch: { applicationName: name },
        describe: `Named the application ${name}`,
      },
    };
  },
};

const addNetworkConnectionTool: ToolDef = {
  name: 'add_network_connection',
  description:
    'Add something the application must talk to, or that must reach it. Each one ' +
    'becomes a NetworkPolicy. Use on-premises with CIDRs for a datacentre network, ' +
    'azure-service for Azure PaaS (note: NetworkPolicy cannot express Azure ' +
    'service tags, so that emits a caveat rather than a rule).',
  parameters: {
    type: 'object',
    properties: {
      name: str('Short label, e.g. "Oracle on-prem"'),
      direction: { type: 'string', enum: ['ingress', 'egress'] },
      kind: { type: 'string', enum: ['internet', 'namespace', 'on-premises', 'azure-service'] },
      namespace: str('Required when kind is namespace'),
      cidrs: { type: 'array', items: { type: 'string' }, description: 'Required when kind is on-premises' },
      service: str('Required when kind is azure-service, e.g. "Azure SQL"'),
      port: num('Optional TCP port'),
    },
    required: ['name', 'direction', 'kind'],
    additionalProperties: false,
  },
  run: async (a, ctx) => {
    const name = String(a.name ?? '').slice(0, 60);
    const direction = a.direction as 'ingress' | 'egress';
    if (!name) return { result: { error: 'name is required' } };
    if (direction !== 'ingress' && direction !== 'egress') {
      return { result: { error: 'direction must be ingress or egress' } };
    }

    let target: PlannerState['endpoints'][number]['target'];
    switch (a.kind) {
      case 'internet':
        target = { kind: 'internet' };
        break;
      case 'namespace':
        if (typeof a.namespace !== 'string' || !a.namespace) {
          return { result: { error: 'namespace is required when kind is namespace' } };
        }
        target = { kind: 'namespace', namespace: a.namespace };
        break;
      case 'on-premises': {
        const cidrs = Array.isArray(a.cidrs) ? a.cidrs.map(String).filter(Boolean) : [];
        if (cidrs.length === 0) {
          return { result: { error: 'at least one CIDR is required when kind is on-premises' } };
        }
        target = { kind: 'on-premises', cidrs };
        break;
      }
      case 'azure-service':
        if (typeof a.service !== 'string' || !a.service) {
          return { result: { error: 'service is required when kind is azure-service' } };
        }
        target = { kind: 'azure-service', service: a.service };
        break;
      default:
        return { result: { error: 'unknown kind' } };
    }

    const port = Number(a.port);
    const endpoint = {
      name,
      direction,
      target,
      ...(Number.isFinite(port) && port > 0 && port <= 65535
        ? { ports: [{ protocol: 'TCP' as const, port: Math.round(port) }] }
        : {}),
    };

    if (ctx.state.endpoints.length >= 50) {
      return { result: { error: 'too many connections already' } };
    }
    const endpoints = [...ctx.state.endpoints, endpoint];
    ctx.state.endpoints = endpoints;

    return {
      result: { ok: true, added: endpoint, total: endpoints.length },
      action: {
        tool: 'add_network_connection',
        patch: { endpoints },
        describe: `Added ${direction} connection "${name}"`,
      },
    };
  },
};

const setStorageTool: ToolDef = {
  name: 'set_storage',
  description:
    'Set how much persistent volume storage the application needs, in GiB, and ' +
    'which managed disk tier backs it. Azure bills a disk at its PROVISIONED ' +
    'tier, not at what is used, so 300 GiB is billed as a 512 GiB disk - say so ' +
    'if the request sits just above a boundary. Premium SSD is the default and ' +
    'what ARO uses; Standard SSD is cheaper and slower.',
  parameters: {
    type: 'object',
    properties: {
      storageGiB: num('Total persistent volume storage in GiB, 0 to 32767. 0 means none.'),
      tier: {
        type: 'string',
        enum: ['premium-ssd', 'standard-ssd'],
        description: 'Managed disk tier. Omit to keep the current one.',
      },
    },
    required: ['storageGiB'],
    additionalProperties: false,
  },
  run: async (a, ctx) => {
    const gib = Math.round(Number(a.storageGiB));
    if (!Number.isFinite(gib) || gib < 0 || gib > 32767) {
      return { result: { error: 'storageGiB must be between 0 and 32767' } };
    }
    const tier =
      a.tier === 'standard-ssd' || a.tier === 'premium-ssd' ? a.tier : ctx.state.storageTier;

    ctx.state.storageGiB = gib;
    ctx.state.storageTier = tier;

    const plan = gib > 0 ? planStorage(gib, tier) : null;
    return {
      result: {
        ok: true,
        storageGiB: gib,
        tier,
        // Hand back the billing consequence so the assistant can report it
        // rather than implying the request is what gets charged.
        billedAs: plan ? `${plan.disk.name} (${plan.disk.gib} GiB provisioned)` : 'no storage',
        paidForButUnusableGiB: plan?.wastedGiB ?? 0,
        storageClass: gib > 0 ? storageClassFor(tier) : null,
      },
      action: {
        tool: 'set_storage',
        patch: { storageGiB: gib, storageTier: tier },
        describe:
          gib > 0
            ? `Set storage to ${gib} GiB (${STORAGE_TIER_LABEL[tier]})`
            : 'Removed the storage request',
      },
    };
  },
};

export const TOOLS: ToolDef[] = [
  recommendNodePoolsTool,
  estimateCostTool,
  listSupportedSkusTool,
  suggestNetworkPoliciesTool,
  lookupAroDocTool,
  setApplicationNameTool,
  setCapacityTool,
  setDeploymentModelTool,
  setClusterOptionsTool,
  setStorageTool,
  addNetworkConnectionTool,
];

export const TOOLS_BY_NAME = new Map(TOOLS.map(t => [t.name, t]));
