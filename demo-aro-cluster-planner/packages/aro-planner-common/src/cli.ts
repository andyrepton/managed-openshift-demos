#!/usr/bin/env node
/**
 * Exercise the planner engine from a terminal, against live Azure prices.
 *
 * This is the same code path the wizard and the MCP server will use - it is a thin
 * shell over recommendNodePools() and estimateCost(), not a parallel implementation.
 *
 *   yarn estimate --vcpu 40 --ram 160 --region westeurope
 *   yarn estimate --vcpu 64 --ram 512 --profile memory-heavy --flavour classic
 */

import { buildPriceTable } from './azurePrices.js';
import { estimateCost } from './cost.js';
import { recommendNodePools } from './recommend.js';
import { categoriesForProfile, findSkus, getSku, inferProfile } from './skus.js';
import type { AroFlavour, ClusterPlan, SizingRequest, WorkloadProfile } from './types.js';

interface Args {
  vcpu: number;
  ramGiB: number;
  region: string;
  flavour: AroFlavour;
  profile?: WorkloadProfile;
  highAvailability: boolean;
  dayTwo: boolean;
  controlPlaneSku: string;
  hcpFee: number | null;
  openshiftVersion?: string;
}

function parseArgs(argv: string[]): Args {
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const has = (name: string) => argv.includes(`--${name}`);

  const vcpu = Number(get('vcpu') ?? 40);
  const ramGiB = Number(get('ram') ?? 160);
  if (!Number.isFinite(vcpu) || !Number.isFinite(ramGiB) || vcpu <= 0 || ramGiB <= 0) {
    throw new Error('--vcpu and --ram must be positive numbers');
  }

  const hcpFeeRaw = get('hcp-fee');
  const profile = get('profile') as WorkloadProfile | undefined;
  const version = get('openshift-version');

  return {
    vcpu,
    ramGiB,
    region: get('region') ?? 'westeurope',
    flavour: (get('flavour') as AroFlavour) ?? 'hcp',
    ...(profile ? { profile } : {}),
    highAvailability: !has('no-ha'),
    dayTwo: has('day-two'),
    controlPlaneSku: get('control-plane-sku') ?? 'Standard_D8s_v3',
    hcpFee: hcpFeeRaw === undefined ? null : Number(hcpFeeRaw),
    ...(version ? { openshiftVersion: version } : {}),
  };
}

/** Matches DEFAULT_OVERRIDES.hoursPerMonth; used for the per-option monthly delta. */
const HOURS_PER_MONTH = 730;

const money = (n: number, dp = 2) =>
  n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });

const SOURCE_MARK: Record<string, string> = {
  'azure-api': ' ',
  override: '~',
  assumption: '?',
};

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const profile = args.profile ?? inferProfile(args.vcpu, args.ramGiB);

  const req: SizingRequest = {
    flavour: args.flavour,
    region: args.region,
    vcpu: args.vcpu,
    ramGiB: args.ramGiB,
    profile,
    highAvailability: args.highAvailability,
    dayTwo: args.dayTwo,
    ...(args.openshiftVersion ? { openshiftVersion: args.openshiftVersion } : {}),
  };

  console.log(
    `\nRequest: ${args.vcpu} vCPU / ${args.ramGiB} GiB allocatable, ${args.flavour.toUpperCase()} in ${args.region}`,
  );
  console.log(
    `Profile: ${profile}${args.profile ? '' : ' (inferred from RAM:vCPU ratio)'}` +
      `   HA: ${args.highAvailability ? 'yes, 3 AZs' : 'no'}` +
      `   Day-2 sizes: ${args.dayTwo ? 'allowed' : 'excluded'}`,
  );

  // Price only the plausible candidates rather than every supported SKU.
  const candidates = findSkus({
    role: 'worker',
    categories: categoriesForProfile(profile),
    allowDay2Only: args.dayTwo,
    ...(args.openshiftVersion ? { openshiftVersion: args.openshiftVersion } : {}),
  });
  const cpSku = getSku(args.controlPlaneSku, 'control-plane');
  if (args.flavour === 'classic' && !cpSku) {
    throw new Error(`${args.controlPlaneSku} is not a supported ARO control plane size`);
  }

  process.stderr.write(`Fetching live Azure prices for ${candidates.length} candidate SKUs...\n`);
  const prices = await buildPriceTable(cpSku ? [...candidates, cpSku] : candidates, args.region);
  process.stderr.write(`Priced ${Object.keys(prices.vm).length} of them in ${args.region}.\n`);

  const recs = recommendNodePools(req, { prices, limit: 3 });
  if (recs.length === 0) {
    console.error('\nNo supported VM size can satisfy that request in this region.');
    return 1;
  }

  console.log('\n── Recommended node pools ───────────────────────────────────────');
  const cheapest = recs[0]?.hourlyVmCost;
  recs.forEach((r, i) => {
    const vm = r.hourlyVmCost;
    const delta =
      vm !== undefined && cheapest !== undefined && vm > cheapest
        ? `  (+$${money((vm - cheapest) * HOURS_PER_MONTH)}/mo vs option 1)`
        : '';
    console.log(
      `\n${i === 0 ? '►' : ' '} ${i + 1}. ${r.nodes} x ${r.sku.name}` +
        `  -  $${money(vm ?? 0, 4)}/hr VM cost${delta}`,
    );
    console.log(
      `      ${r.totalVcpu} vCPU / ${r.totalRamGiB} GiB raw, ${Math.round(r.waste * 100)}% spare after OpenShift overhead`,
    );
    for (const line of r.rationale) console.log(`      ${line}`);
  });

  if (recs.length > 1 && recs[0]!.waste > recs[1]!.waste) {
    console.log(
      '\n  Note: option 1 has more spare capacity than option 2 yet still costs less -' +
        '\n  fewer, larger nodes amortise the per-node OpenShift reservation better.',
    );
  }

  const best = recs[0]!;
  const plan: ClusterPlan = {
    flavour: args.flavour,
    region: args.region,
    ...(args.flavour === 'classic' && cpSku ? { controlPlaneSku: cpSku } : {}),
    workerPools: [best],
  };

  const est = estimateCost(plan, prices, { hcpControlPlanePerHour: args.hcpFee });

  console.log('\n── Cost of option 1 ─────────────────────────────────────────────');
  const w = Math.max(...est.lines.map(l => l.label.length));
  for (const l of est.lines) {
    const mark = SOURCE_MARK[l.source] ?? ' ';
    const amount = l.included ? `$${money(l.hourly, 4)}/hr` : '(excluded)';
    console.log(`${mark} ${l.label.padEnd(w)}  ${amount.padStart(14)}`);
    if (l.detail) console.log(`  ${' '.repeat(w)}  ${l.detail}`);
  }

  console.log('\n' + '─'.repeat(66));
  console.log(
    `  TOTAL  $${money(est.hourly, 4)}/hr   $${money(est.monthly)}/month   $${money(est.yearly)}/year`,
  );
  console.log(`  (${est.currency}, ${est.hoursPerMonth} hours/month, list price, no discounts)`);

  console.log('\n  Legend:   (blank) from the Azure Retail Prices API');
  console.log('            ~       locally configured override');
  console.log('            ?       assumption - NOT an Azure-published figure');

  if (est.assumptions.length) {
    console.log('\n── Read this before quoting the number ──────────────────────────');
    for (const a of est.assumptions) console.log(`  ! ${a}`);
  }
  console.log();
  return 0;
}

main().then(
  code => process.exit(code),
  err => {
    console.error(`\nError: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  },
);
