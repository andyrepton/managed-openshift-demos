# Developer Tooling Dashboard -- ARO Cluster Planner

A self-service wizard where a team describes a workload in their own terms -- vCPUs, RAM, application type, which network endpoints they need -- and gets back a live Azure-priced cost estimate, a recommended node pool and instance type, NetworkPolicy YAML, and an output bundle they can raise as a pull request.

Built as a Red Hat Developer Hub plugin, on top of **[demo-developer-hub](../demo-developer-hub)** (the RHDH install) and **demo-rhdh-lightspeed-with-custom-mcp** (the assistant).

## Status

| Phase | What | State |
| --- | --- | --- |
| C1 | Sizing + cost + NetworkPolicy engine | **Done** -- 35 tests passing |
| C2 | Backend price proxy and wizard UI | In progress -- price client done, UI not started |
| C3 | Export as an RHDH dynamic plugin | Not started |
| C4 | Scaffolder template and GitHub PR output | Not started |
| C5 | MCP server so the assistant can use the same tools | Not started |

There is no web UI yet. Use the CLI below to exercise the engine.

## Try it

Needs Node 24 (RHDH 2.x pins `engines.node: 24`) and Yarn 4 via Corepack.

```bash
cd developer-tooling-dashboard
yarn install

cd packages/aro-planner-common
yarn test                      # 35 unit tests, no network
yarn estimate --vcpu 40 --ram 160 --region westeurope
```

`yarn estimate` hits the live Azure Retail Prices API and prints the ranked node pool options with a costed breakdown:

```
► 1. 3 x Standard_D16as_v5  -  $2.4960/hr VM cost
      48 vCPU / 192 GiB raw, 11% spare after OpenShift overhead
  2. 6 x Standard_D8as_v4   -  $2.7600/hr VM cost  (+$192.72/mo vs option 1)
      48 vCPU / 192 GiB raw, 5% spare after OpenShift overhead

  Note: option 1 has more spare capacity than option 2 yet still costs less -
  fewer, larger nodes amortise the per-node OpenShift reservation better.
```

### Options

| Flag | Default | Notes |
| --- | --- | --- |
| `--vcpu` | 40 | Treated as **allocatable**, not raw |
| `--ram` | 160 | GiB, also allocatable |
| `--region` | `westeurope` | Azure `armRegionName` |
| `--flavour` | `hcp` | `hcp` or `classic` |
| `--profile` | inferred | `general`, `memory-heavy`, `compute-heavy`, `storage-heavy`, `gpu` |
| `--no-ha` | off | Skip rounding node count to a multiple of 3 |
| `--day-two` | off | Allow sizes Microsoft supports only as day-2 pool additions |
| `--control-plane-sku` | `Standard_D8s_v3` | Classic ARO only |
| `--hcp-fee` | unset | Hourly HCP control-plane fee (see below) |
| `--openshift-version` | unset | Filters out sizes needing a newer ARO |

## How the costing works

Four components, each tagged with where its number came from. The UI and CLI render
`azure-api`, `override` and `assumption` differently, because "Azure told us this" and
"we guessed" must never look alike.

1. **Worker VM compute** -- Linux on-demand, per SKU per region.
2. **Control plane VM compute** -- classic ARO only. Three nodes, charged as infrastructure but **never licensed**.
3. **ARO licence** -- worker vCPUs only, at a flat **$0.0428/vCPU/hr**.
4. **Hosted control plane fee** -- ARO HCP only, and **unpublished** (see below).

Storage, egress and load balancers are listed but excluded, and the estimate says so.

### Traps encoded in the tests

Both of these were found by querying the live API, and both fail silently rather than loudly, which is why they have dedicated tests.

**ARO licence meters are not where you would look for them.** `serviceName eq 'Azure Red Hat OpenShift'` returns **zero** results, and `contains(serviceName, ...)` is unsupported. They live under `serviceName = 'Virtual Machines Licenses'` with a `productName` of `Azure Red Hat OpenShift <category>` and a `meterName` of `"<n> vCPU"`.

**A VM SKU query returns six rows, not one.** Querying `Standard_D8s_v5` in westeurope returns Linux and Windows, each in standard, Spot and Low Priority variants. Spot is $0.085/hr against $0.46 on-demand -- taking the wrong row understates a cluster by 5x. `isLinuxOnDemand()` isolates this and is asserted directly.

Two API limits also matter: the OData filter breaks somewhere between 15 and 18 `armSkuName eq` clauses (400 Bad Request), and the endpoint rate-limits with 429 under modest fan-out. Requests are chunked at 12 and retried with backoff.

The API sends **no CORS headers**, so all of this must run server-side -- the backend proxy or the MCP server, never the browser.

### The one number we cannot stand behind

Microsoft has **not published** the ARO HCP per-cluster control-plane fee. It is absent from both the pricing page and the Retail Prices API. Rather than quietly pricing it at zero, the estimate excludes it, marks it `?`, and says so in the summary:

```
? Hosted control plane fee                (excluded)
! The ARO HCP per-cluster control-plane fee is NOT included - Microsoft has not
  published a rate. The real total will be higher than shown.
```

Supply one with `--hcp-fee 0.25` and it is included but tagged `override`, never `azure-api`.

## Sizing

The caller's vCPU/RAM figures are treated as **allocatable** -- what pods can actually request -- so per-node OpenShift overhead (1 vCPU, 4 GiB) is subtracted before dividing. Sizing against raw VM specs is the classic way to come up ~15% short.

Candidates are then filtered to the right family for the workload profile, node count is floored at ARO's three-worker minimum and rounded to a multiple of three for an even AZ spread, day-2-only sizes are excluded when building a new cluster, and the survivors are ranked by cost.

## The SKU catalogue

`data/sku-catalog.json` and `src/generated/sku-catalog.ts` hold 272 entries generated from [Microsoft's ARO support policy](https://learn.microsoft.com/en-us/azure/openshift/support-policies-v4) -- the authoritative list of what ARO actually supports, which is far smaller than what Azure offers, and unlike `az vm list-skus` needs no credentials.

The source markdown is in a private repo, so the generator parses rendered HTML. That is brittle, which is why the output is committed and the runtime never calls it:

```bash
python3 -I scripts/generate-sku-catalog.py          # regenerate
python3 -I scripts/generate-sku-catalog.py --check  # exit 1 if the page changed
```

Run `--check` periodically to notice when Microsoft adds sizes.

## Layout

```
packages/aro-planner-common/     Pure TypeScript. No React, no cluster.
  src/types.ts                   Domain model
  src/skus.ts                    Catalogue queries, overhead, licence meter mapping
  src/recommend.ts               Sizing recommender
  src/cost.ts                    Pure cost model over a PriceTable
  src/azurePrices.ts             Retail Prices API client (server-side only)
  src/cli.ts                     yarn estimate
scripts/generate-sku-catalog.py  SKU catalogue generator + drift check
```

Everything lives in `aro-planner-common` so the wizard, the backend and the MCP server import the *same* functions -- the assistant and the page can never disagree about a number.
