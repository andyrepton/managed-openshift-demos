# ARO Cluster Planner

A self-service wizard where a team describes a workload -- vCPUs, RAM, application type, connectivity -- and gets back a live Azure-priced cost estimate, a recommended node pool and instance type, and NetworkPolicy YAML. Runs as a plugin inside Red Hat Developer Hub.

## Overview

* **Sizing recommender** -- maps a vCPU/RAM request to ranked node pool options from Microsoft's published list of ARO-supported VM sizes.
* **Live costing** -- worker VMs, control plane, ARO licence and storage, priced from the Azure Retail Prices API as the form changes.
* **Provenance on every figure** -- each line is tagged as a live Azure price, a locally configured override, or an assumption.
* **Backend price proxy** -- caches Azure responses and serves stale prices with a warning rather than failing.

Depends on **[demo-developer-hub](../demo-developer-hub)** for the RHDH instance it plugs into.

## Status

| Phase | Scope | State |
| --- | --- | --- |
| C1 | Sizing, cost and NetworkPolicy engine | Done |
| C2 | Backend price proxy and wizard UI | Backend done, UI in progress |
| C3 | Export as an RHDH dynamic plugin | Not started |
| C4 | Scaffolder template and GitHub PR output | Not started |
| C5 | MCP server exposing the same tools to the assistant | Not started |

## Prerequisites

* Node 24 and Yarn 4 via Corepack. RHDH 1.10 pins `engines.node: 24`.
* Outbound HTTPS to `prices.azure.com`. No Azure credentials are needed -- the Retail Prices API is unauthenticated.

## How to Run the Demo

### 1. Install

```bash
yarn install
yarn workspace @aro-planner/common build
```

### 2. Run the tests

```bash
yarn workspace @aro-planner/common test    # 35 tests
yarn workspace @aro-planner/backend test   # 21 tests
```

### 3. Price a cluster from the CLI

```bash
cd packages/aro-planner-common
yarn estimate --vcpu 40 --ram 160 --region westeurope
```

```
► 1. 3 x Standard_D16as_v5  -  $2.4960/hr VM cost
      48 vCPU / 192 GiB raw, 11% spare after OpenShift overhead
  2. 6 x Standard_D8as_v4   -  $2.7600/hr VM cost  (+$192.72/mo vs option 1)

  TOTAL  $4.5480/hr   $3,320.04/month   $39,840.48/year
```

| Flag | Default | Notes |
| --- | --- | --- |
| `--vcpu` | 40 | Treated as **allocatable**, not raw |
| `--ram` | 160 | GiB, also allocatable |
| `--region` | `westeurope` | Azure `armRegionName` |
| `--flavour` | `hcp` | `hcp` or `classic` |
| `--profile` | inferred | `general`, `memory-heavy`, `compute-heavy`, `storage-heavy`, `gpu` |
| `--no-ha` | off | Skip rounding node count to a multiple of 3 |
| `--day-two` | off | Allow sizes supported only as day-2 pool additions |
| `--control-plane-sku` | `Standard_D8s_v3` | Classic ARO only |
| `--hcp-fee` | unset | Hourly HCP control-plane fee |

### 4. Run the backend and wizard

```bash
yarn workspace @aro-planner/backend start   # http://localhost:7008
yarn workspace @aro-planner/wizard dev      # http://localhost:3010
```

The wizard proxies `/api/aro-planner` to the backend, so it calls the same relative path it will use once mounted inside RHDH.

```bash
curl -s localhost:7008/api/aro-planner/health
curl -s -X POST localhost:7008/api/aro-planner/plan \
  -H 'Content-Type: application/json' \
  -d '{"vcpu":40,"ramGiB":160,"region":"westeurope","flavour":"hcp"}'
```

## Costing model

Four components, each tagged with its source:

1. **Worker VM compute** -- Linux on-demand, per SKU per region.
2. **Control plane VM compute** -- classic ARO only. Three nodes, charged as infrastructure but never licensed.
3. **ARO licence** -- worker vCPUs only, at a flat $0.0428/vCPU/hr.
4. **Hosted control plane fee** -- ARO HCP only, and unpublished by Microsoft.

Storage, egress and load balancers are listed but excluded, and the estimate says so.

Set unpublished values in `config/pricing-overrides.json` (see `pricing-overrides.example.json`). Anything left unset is excluded and labelled rather than counted as zero.

## Sizing model

The requested vCPU and RAM are treated as **allocatable** -- what pods can request -- so per-node OpenShift overhead of 1 vCPU and 4 GiB is subtracted before dividing. Sizing against raw VM specs under-provisions by roughly 15%.

Candidates are filtered to the family matching the workload profile, node count is floored at ARO's three-worker minimum and rounded to a multiple of three for an even AZ spread, day-2-only sizes are excluded when building a new cluster, and the survivors are ranked by cost.

Fewer, larger nodes often win: for 40 vCPU / 160 GiB, `3 x D16as_v5` is cheaper than `6 x D8as_v4` despite having more spare capacity, because the per-node reservation is amortised over half as many nodes.

## SKU catalogue

`data/sku-catalog.json` and `src/generated/sku-catalog.ts` hold 272 entries generated from [Microsoft's ARO support policy](https://learn.microsoft.com/en-us/azure/openshift/support-policies-v4), the authoritative list of sizes ARO supports. Unlike `az vm list-skus` it needs no credentials and already excludes sizes ARO will not run.

The source markdown is in a private repo, so the generator parses rendered HTML. The output is committed and the runtime never calls the generator:

```bash
python3 -I scripts/generate-sku-catalog.py          # regenerate
python3 -I scripts/generate-sku-catalog.py --check  # exit 1 if the page changed
```

## Layout

```
packages/aro-planner-common/     Pure TypeScript. No React, no cluster.
  src/types.ts                   Domain model
  src/skus.ts                    Catalogue queries, overhead, licence meter mapping
  src/recommend.ts               Sizing recommender
  src/cost.ts                    Pure cost model over a PriceTable
  src/azurePrices.ts             Retail Prices API client (server-side only)
  src/cli.ts                     yarn estimate
plugins/aro-planner-backend/     Express router, TTL cache, overrides loader
plugins/aro-planner/             Vite + React wizard with the live cost panel
scripts/generate-sku-catalog.py  SKU catalogue generator and drift check
```

All pure logic lives in `aro-planner-common` so the wizard, the backend and the MCP server import the same functions and cannot disagree about a number.

## Notes

* **ARO licence meters are not under `serviceName eq 'Azure Red Hat OpenShift'`** -- that returns zero results. They live under `serviceName = 'Virtual Machines Licenses'` with a `productName` of `Azure Red Hat OpenShift <category>` and a `meterName` of `"<n> vCPU"`.
* **A VM SKU query returns six rows, not one** -- Linux and Windows, each in standard, Spot and Low Priority variants. Spot is $0.085/hr against $0.46 on-demand, so taking the wrong row understates a cluster fivefold. `isLinuxOnDemand()` isolates this.
* The OData filter fails between 15 and 18 `armSkuName eq` clauses, and the endpoint rate-limits with 429. Requests are chunked at 12 and retried with backoff; a 400 is never retried.
* The Retail Prices API sends **no CORS headers**, so pricing must run server-side.
* **Microsoft has not published the ARO HCP per-cluster control-plane fee.** It is absent from both the pricing page and the Retail Prices API, so it is excluded from totals and flagged. Supply one with `--hcp-fee` or in the overrides file and it is tagged as a configured value, never as an Azure price.

## Related Demos

* **[Red Hat Developer Hub](../demo-developer-hub)** -- the RHDH instance this plugs into.

## Clean Up

Nothing is deployed to a cluster yet. To reset the local build:

```bash
yarn workspaces foreach --all run clean 2>/dev/null || true
rm -rf node_modules packages/*/dist plugins/*/dist
```
