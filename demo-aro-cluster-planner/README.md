# ARO Cluster Planner

A self-service wizard where a team names an application, says how much capacity it needs and what it must talk to, and gets back a live Azure-priced comparison of where it could run, a recommended node pool, and the NetworkPolicies to go with it. Runs as a Red Hat Developer Hub dynamic plugin.

## Overview

* **Deployment model comparison** -- namespace on a shared cluster, dedicated ARO cluster, or on-premises, each with a cost.
* **Live Azure pricing** -- worker VMs, control plane and ARO licence, from the Azure Retail Prices API as the form changes.
* **Provenance on every figure** -- each line is tagged as a live Azure price, a configured override, or an assumption.
* **NetworkPolicy generation** -- connectivity requirements become a default-deny baseline plus one rule per connection.
* **MCP tools** -- the same engine exposed to an AI assistant, so it cannot disagree with the page.

Depends on **[demo-developer-hub](../demo-developer-hub)** for the RHDH instance it plugs into.

## What works today

Sizing, costing, the deployment model comparison and NetworkPolicy generation are
complete and deployed as an RHDH dynamic plugin, along with MCP tools that expose the
same engine to an AI assistant.

Not yet built: an in-page assistant that can adjust the form, artifact generation
(`plan.md`, tfvars, manifests), and the Scaffolder template that raises the request as
a pull request. The Request button therefore shows a summary rather than submitting.

## Prerequisites

* Node 24 and Yarn 4 via Corepack. RHDH 1.10 pins `engines.node: 24`.
* Outbound HTTPS to `prices.azure.com`. No Azure credentials needed -- the Retail Prices API is unauthenticated.
* For deploying: an RHDH 1.10 instance, and a container registry the cluster can pull from.

## How to Run the Demo

### 1. Install and test

```bash
yarn install
yarn workspace @aro-planner/common build

yarn workspace @aro-planner/common test                          # 66 tests
yarn workspace @aro-planner/backstage-plugin-aro-planner-backend test   # 31 tests
```

### 2. Price a cluster from the CLI

The quickest way to see the engine work, with no cluster involved:

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
| `--hcp-fee` | unset | Hourly HCP control-plane fee |

### 3. Build and deploy the plugins

Both plugins ship in one registry image. `FROM scratch` is mandatory -- see Notes.

```bash
# Build and export both as RHDH dynamic plugins
for p in aro-planner aro-planner-backend; do
  (cd plugins/$p && yarn tsc && yarn build)
done
(cd plugins/aro-planner && npx @red-hat-developer-hub/cli@release-1.10 plugin export --clean)
(cd plugins/aro-planner-backend && \
   npx @red-hat-developer-hub/cli@release-1.10 plugin export --clean --embed-package @aro-planner/common)

# Collect both into a registry directory
npx @red-hat-developer-hub/cli@release-1.10 plugin package --export-to ./plugin-registry
printf 'FROM scratch\nCOPY . /\n' > plugin-registry/Containerfile
```

Build the image on the cluster -- no local container tooling needed:

```bash
oc apply -f - <<'EOF'
apiVersion: image.openshift.io/v1
kind: ImageStream
metadata: { name: aro-planner, namespace: rhdh }
---
apiVersion: build.openshift.io/v1
kind: BuildConfig
metadata: { name: aro-planner, namespace: rhdh }
spec:
  source: { type: Binary, binary: {} }
  strategy: { type: Docker, dockerStrategy: { dockerfilePath: Containerfile } }
  output: { to: { kind: DockerImage, name: quay.io/<you>/aro-planner:0.1.0 } }
EOF

oc -n rhdh create secret docker-registry quay-push \
  --docker-server=quay.io --docker-username="<robot>" --docker-password="<token>"
oc -n rhdh patch bc aro-planner --type merge \
  -p '{"spec":{"output":{"pushSecret":{"name":"quay-push"}}}}'

oc start-build aro-planner -n rhdh --from-dir=plugin-registry --follow
```

### 4. Load them into RHDH

Add both to `dynamic-plugins.yaml` in [demo-developer-hub](../demo-developer-hub). The `!<plugin-path>` suffix is required -- see Notes.

```yaml
- package: 'oci://quay.io/<you>/aro-planner:0.1.0!aro-planner-backstage-plugin-aro-planner-backend'
  disabled: false
- package: 'oci://quay.io/<you>/aro-planner:0.1.0!aro-planner-backstage-plugin-aro-planner'
  disabled: false
  pluginConfig:
    dynamicPlugins:
      frontend:
        aro-planner.backstage-plugin-aro-planner:
          dynamicRoutes:
            - path: /aro-planner
              importName: AroPlannerPage
              menuItem: { icon: category, text: ARO Planner }
          scaffolderFieldExtensions:
            - importName: AroClusterPlannerFieldExtension
```

Then `oc -n rhdh rollout restart deployment/backstage-developer-hub` and open **ARO Planner** in the sidebar.

## Costing model

Four components, each tagged with its source:

1. **Worker VM compute** -- Linux on-demand, per SKU per region, from Azure.
2. **Control plane VM compute** -- classic ARO only. Three nodes, charged as infrastructure but never licensed.
3. **ARO licence** -- worker vCPUs only, at a flat $0.0428/vCPU/hr.
4. **Hosted control plane fee** -- ARO HCP only, and unpublished by Microsoft.

Storage, egress and load balancers are listed but excluded, and the estimate says so.

**Only the dedicated ARO cluster is priced from a real meter.** A shared namespace is shown at 50% of its per-vCPU rate and on-premises at 5x -- multipliers invented to make the comparison concrete, defined in `DEMO_MULTIPLIERS` in `compare.ts`. They are not benchmarks and not Red Hat guidance. The UI marks them with `~` and a warning; replace them with your own figures before using this to decide anything.

The ARO HCP control-plane fee is likewise an assumption -- Microsoft has not published one. Set it in app-config under `aroPlanner.*` with a provenance note.

## Sizing model

Requested vCPU and RAM are treated as **allocatable** -- what pods can request -- so per-node OpenShift overhead of 1 vCPU and 4 GiB is subtracted before dividing. Sizing against raw VM specs under-provisions by roughly 15%.

Candidates are filtered to the family matching the workload profile, node count is floored at ARO's three-worker minimum and rounded to a multiple of three for an even AZ spread, day-2-only sizes are excluded when building a new cluster, and the survivors are ranked by cost.

Fewer, larger nodes often win: for 40 vCPU / 160 GiB, `3 x D16as_v5` beats `6 x D8as_v4` despite more spare capacity, because the per-node reservation is amortised over half as many nodes.

## SKU catalogue

272 entries generated from [Microsoft's ARO support policy](https://learn.microsoft.com/en-us/azure/openshift/support-policies-v4). Unlike `az vm list-skus` it needs no credentials and already excludes sizes ARO will not run. The source markdown is in a private repo, so the generator parses rendered HTML; the output is committed and the runtime never calls it.

```bash
python3 -I scripts/generate-sku-catalog.py          # regenerate
python3 -I scripts/generate-sku-catalog.py --check  # exit 1 if the page changed
```

## Layout

```
packages/aro-planner-common/     Pure TypeScript. No React, no cluster.
  src/skus.ts                    Catalogue, overhead, licence meter mapping
  src/recommend.ts               Sizing recommender
  src/cost.ts                    Pure cost model over a PriceTable
  src/compare.ts                 Deployment model comparison
  src/netpol.ts                  NetworkPolicy generation
  src/azurePrices.ts             Retail Prices API client (server-side only)
  src/cli.ts                     yarn estimate
plugins/aro-planner-backend/     Backstage backend plugin: router, cache, MCP tools
plugins/aro-planner/             Backstage frontend plugin: the wizard
```

All pure logic lives in `aro-planner-common` so the wizard, the backend and the MCP server import the same functions and cannot disagree about a number.

## Notes

* **`FROM scratch` is mandatory for the plugin image.** RHDH's installer takes `manifest['layers'][0]` and treats that single layer as the plugin tarball. Any base image puts its own filesystem in layer 0, the plugin is never found, and the install reports success while leaving an empty directory.
* **The `!<plugin-path>` suffix matters.** Without it RHDH auto-detects the path from the `io.backstage.dynamic-packages` OCI annotation, which only the RHDH CLI's own packager sets. Naming it explicitly lets an ordinary OpenShift build produce a usable image.
* **Match the CLI to the RHDH version** -- `@red-hat-developer-hub/cli@release-1.10`. `@latest` is 2.x and treats the scalprum config as legacy.
* The key under `dynamicPlugins.frontend` must equal `scalprum.name` in the plugin's `package.json`, or it is discovered and never loaded.
* **ARO licence meters are not under `serviceName eq 'Azure Red Hat OpenShift'`** -- that returns nothing. They live under `Virtual Machines Licenses` with a `productName` of `Azure Red Hat OpenShift <category>`.
* **A VM SKU query returns six rows, not one** -- Linux and Windows, each in standard, Spot and Low Priority. Spot is $0.085/hr against $0.46 on-demand, so taking the wrong row understates a cluster fivefold.
* The OData filter fails between 15 and 18 `armSkuName` clauses, and the endpoint rate-limits with 429. Requests are chunked at 12 and retried; a 400 is never retried.
* The Retail Prices API sends **no CORS headers**, so pricing must run server-side.
* The MCP endpoint only accepts in-pod callers, checked on the TCP peer address. The assistant sidecar shares the pod; an `Origin` header would be forgeable.

## Related Demos

* **[Red Hat Developer Hub](../demo-developer-hub)** -- the RHDH instance this plugs into.

## Clean Up

```bash
oc -n rhdh delete bc/aro-planner is/aro-planner secret/quay-push
rm -rf node_modules packages/*/dist plugins/*/dist plugins/*/dist-dynamic plugin-registry dist-types
```
