# Deployment Planner

A self-service wizard where a team names an application, says how much capacity it needs and what it must talk to, and gets back a live Azure-priced comparison of where it could run, a recommended node pool, and the NetworkPolicies to go with it. Runs as a Red Hat Developer Hub dynamic plugin.

## Overview

* **Deployment model comparison** -- namespace on a shared cluster, dedicated ARO cluster, or on-premises, each with a cost.
* **Live Azure pricing** -- worker VMs, control plane and ARO licence, from the Azure Retail Prices API as the form changes.
* **Provenance on every figure** -- each line is tagged as a live Azure price, a configured override, or an assumption.
* **NetworkPolicy generation** -- connectivity requirements become a default-deny baseline plus one rule per connection.
* **Artifact generation** -- a plan document, a tfvars for one Terraform module, and the namespace manifests.
* **In-page assistant** -- asks questions and fills the form in, using tools over the same engine.
* **MCP tools** -- the same engine exposed to RHDH's assistant, so it cannot disagree with the page.

Depends on **[demo-developer-hub](../demo-developer-hub)** for the RHDH instance it plugs into.

## What works today

Sizing, costing, the deployment model comparison, NetworkPolicy generation and
artifact generation are complete and deployed as an RHDH dynamic plugin, along with
MCP tools exposing the same engine to RHDH's assistant.

The in-page assistant works, against an OpenAI-compatible endpoint. It is off unless
configured, because enabling it puts a model API key on the instance. See
[The assistant](#the-assistant).

Not yet built: the Scaffolder template that raises the request as a pull request. The
Request button therefore shows a summary rather than submitting.

## Prerequisites

* Node 24 and Yarn 4 via Corepack. RHDH 1.10 pins `engines.node: 24`.
* Outbound HTTPS to `prices.azure.com`. No Azure credentials needed -- the Retail Prices API is unauthenticated.
* For deploying: an RHDH 1.10 instance, and a container registry the cluster can pull from.

## How to Run the Demo

### 1. Install and test

```bash
yarn install
yarn workspace @aro-planner/common build

yarn workspace @aro-planner/common test                          # 132 tests
yarn workspace @aro-planner/backstage-plugin-aro-planner-backend test   # 65 tests
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

# Strip node_modules/.bin before building the image.
#
# Those entries are relative symlinks in dist-dynamic, but `plugin package`
# resolves them to absolute paths when it copies, so the tarball ends up
# containing links to the build machine's home directory - published in a
# public image. The installer skips them anyway, so nothing is lost.
find plugin-registry -name .bin -type d -prune -exec rm -rf {} +
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

This demo owns its entry in RHDH's plugin config, in
[`rhdh/dynamic-plugins-entry.yaml`](rhdh/dynamic-plugins-entry.yaml). Compose it
into [demo-developer-hub](../demo-developer-hub) and apply:

```bash
cd ../demo-developer-hub
python3 -I scripts/compose-dynamic-plugins.py \
  ../demo-rhdh-cluster-planner/rhdh/dynamic-plugins-entry.yaml --apply
```

It lives here rather than in that demo so the base deploys on its own: the
plugin installer runs as an init container and raises on an image it cannot
pull, so listing this plugin there left Developer Hub stuck in `Init:Error`
for anyone who had not built it. The `!<plugin-path>` suffix is required -- see Notes.

Then `oc -n rhdh rollout restart deployment/backstage-developer-hub` and open **ARO Planner** in the sidebar.

## The assistant

An in-page chat that both answers and **acts**: it calls tools over the same engine the
page uses, and the ones that write return patches the browser applies to the form. Ask
for "the payments team, 50 users, needs our on-prem Oracle" and the capacity, the
deployment model and the network connection are all set, with the cost panel moving as
it goes. Every change it makes is listed under its reply.

It lives in the plugin rather than using RHDH's Lightspeed drawer because that one is
mounted in a separate React tree with no access to this form's state -- it could advise,
but it could not set a field.

| Read-only | Writes to the form |
| --- | --- |
| `recommend_node_pools` | `set_application_name` |
| `estimate_cost` | `set_capacity` |
| `list_supported_skus` | `set_deployment_model` |
| `suggest_network_policies` | `set_cluster_options` |
| `lookup_aro_doc` | `add_network_connection` |

**It stays off until sign-in is real.** Enabling it puts a model API key on the
instance, so anyone who can load the page can spend it. In
[demo-developer-hub](../demo-developer-hub) that means GitHub sign-in restricted to
`catalog/org.yaml`; while guest sign-in was on, this was deliberately disabled and the
UI said why rather than offering an input that silently discarded text.

To enable, under `aroPlanner.assistant` in app-config:

| Key | Notes |
| --- | --- |
| `baseUrl` | OpenAI-compatible endpoint, e.g. a MaaS or vLLM `/v1`. Must be https |
| `apiKey` | `${ARO_PLANNER_AI_API_KEY}`, backed by a Secret. Never a literal |
| `model` | Served model name |
| `timeoutMs` | Default 60000 |
| `maxRounds` | Tool-calling rounds per turn. Default 5 |

All three of `baseUrl`, `apiKey` and `model` are required; any missing and the assistant
reports itself unavailable. The model must support tool calling.

## Requesting operators

A short approved list of platform services a team can ask for, alongside its own
workload. Selecting one adds its capacity to the cluster being sized, because an
operator runs pods like anything else.

| Operator | Package | Catalog | Adds |
| --- | --- | --- | --- |
| Red Hat build of Keycloak | `rhbk-operator` | `redhat-operators` | 6.1 vCPU / 4.0 GiB |
| Streams for Apache Kafka | `amq-streams` | `redhat-operators` | 4.7 vCPU / 9.4 GiB |
| Apache Flink | `flink-kubernetes-operator` | `community-operators` | 2.25 vCPU / 4.5 GiB |
| OpenShift Data Foundation | `odf-operator` | `redhat-operators` | 3 dedicated nodes — see below |

**The two halves of that table have different provenance, and the UI keeps them
apart.** Availability is live: the backend lists PackageManifests from this
cluster's OperatorHub, so each row shows whether the package is really
installable here and at what version. The footprints are curated constants from
vendor documentation.

They have to be. A `PackageManifest`'s `currentCSVDesc` carries no deployment
spec, and the part that dominates — three Kafka brokers, three Keycloak pods —
lives in a CR that does not exist until someone creates it. No API can answer
"what will this cost me in vCPU", so the figures are written down with their
source and marked as what they are.

Each figure covers **the operator and one default instance of what it manages**.
A controller pod on its own is a rounding error, and sizing a cluster for 200m
of CPU would be theatre.

* **Keycloak** — three pods at 2 vCPU / 1250 MB, from the example CR in the
  [RHBK High Availability Guide](https://docs.redhat.com/en/documentation/red_hat_build_of_keycloak/26.2/html/high_availability_guide/concepts-memory-and-cpu-sizing-).
  That guide sizes CPU by login rate, so a quiet realm needs far less.
* **Streams for Apache Kafka** — three brokers and three KRaft controllers, from
  [Red Hat solution 4205851](https://access.redhat.com/solutions/4205851), which
  is explicitly a **development** starting point and not suitable for
  production. Streams for Apache Kafka sets no default requests or limits on its
  operands at all, so there is no vendor production default to quote.
* **Flink** — one JobManager and one TaskManager, from the upstream
  [`examples/basic.yaml`](https://github.com/apache/flink-kubernetes-operator/blob/main/examples/basic.yaml).
  A real job sets its own parallelism and needs more TaskManagers.

Flink is from **community-operators**: there is no Red Hat-supported Flink in the
catalog. It installs, it carries no support, and the wizard and the plan document
both say so rather than letting it sit unmarked next to two supported products.

**ODF is in the list but behaves differently.** Its capacity is three dedicated
nodes costed as their own pool, so its worker-pod footprint is deliberately
**zero** — a figure there would be added to the worker sizing as well and bill
the same hardware twice. It is also the one entry whose checkbox has no state of
its own: it reflects the storage backends, and ticking it writes there. The
backend derives it from those backends rather than trusting the client, and
strips it when no backend uses it, so the cost panel and the plan document
cannot disagree about whether ODF was requested.

### Letting the backend see OperatorHub

```bash
oc apply -f rbac/operator-catalog-reader.yaml
```

That is a `Role` in `openshift-marketplace` granting `get` and `list` on
`packagemanifests`, bound to the ServiceAccount RHDH runs as. RHDH mounts no
ServiceAccount token by default, so `demo-developer-hub/backstage.yaml` also sets
`automountServiceAccountToken: true`.

Without either, nothing breaks: every operator reports **not checked** with the
reason, and the footprints and sizing still work. "Not in this cluster's catalog"
and "we could not check" are different answers and get different chips — a plan
that asks for something uninstallable must not look fine doing it.

This is the only part of the planner that talks to Kubernetes, which is why it
lives in the backend plugin and not in `@aro-planner/common`: common is bundled
wholesale into the browser, and a cluster token has no business there.

## Storage: two kinds, three backends

The form asks for two capacities, because they are different things bought
differently.

| Capacity | Default backend | Alternative |
| --- | --- | --- |
| **Block** (GiB) — PVCs | Azure managed disks | ODF |
| **Object** (GiB) — buckets | Azure Blob, Hot LRS, live-priced | ODF |

Azure Blob comes from the Retail Prices API like everything else, and the meter
is **graduated**: $0.0196/GB/month for the first 50 TB, then $0.018816, then
$0.018032. Those are bands, not cliffs — 100 TB is the first 50 TB at one rate
and the rest at another. Picking a single band and multiplying is wrong in one
direction or the other depending on which you pick, so the bands are applied
cumulatively.

Blob is also matched on `productName eq 'General Block Blob v2'`, not on the
meter name alone. The legacy `Blob Storage` product publishes a meter with an
identical name at different prices, so the meter name by itself returns both and
the answer depends on arrival order.

### What selecting ODF does

Three things, all of them consequences of running Ceph yourself rather than
buying storage as a service:

1. **Three dedicated nodes**, at ODF's documented minimum of 16 vCPU / 64 GiB
   each ([infrastructure requirements](https://docs.redhat.com/en/documentation/red_hat_openshift_data_foundation/4.20/html/planning_your_deployment/infrastructure-requirements_rhodf)).
   They run no application workload, and their cores are licensed like any other
   worker. They are a separate pool from the worker sizing, not folded into it.
2. **3x replication.** 1000 GiB usable is 3000 GiB provisioned and paid for.
3. **A dedicated cluster becomes mandatory.** ODF labels nodes, claims raw block
   devices and runs cluster-scoped privileged daemons; a tenant namespace on a
   shared cluster can provide none of that. The shared-namespace option is
   disabled with that reason, and the wizard moves the selection rather than
   leaving an impossible combination on screen.

The wizard shows a large, non-dismissible warning pointing at Azure Blob, and
the cost panel keeps the Blob figure visible as an **excluded** line whenever ODF
is serving the buckets. A comparison you have to toggle back and forth to see is
not a comparison.

For 1 TiB of object storage in `westeurope`, measured against the live API:

```
objectBackend=azure-blob     total $3,522.62/mo
  IN   Object storage - Azure Blob (Hot LRS)              $    20.07/mo

objectBackend=odf            total $7,367.67/mo
  IN   ODF nodes - Standard_D16as_v5 x3                   $ 1,822.08/mo
  IN   ARO licence - ODF nodes x3                         $ 1,497.96/mo
  IN   ODF backing disks - P50 (Premium SSD)              $   545.09/mo
  OUT  Object storage - same capacity on Azure Blob       $    20.07/mo
```

**That is the point of the feature**: $20 against $3,865, about 190x, and most
of it is nodes and licensing rather than disk.

None of which means never use ODF. ReadWriteMany volumes, an S3 endpoint inside
the cluster, one storage layer across clouds, or data that must not cross the
cluster boundary are all real reasons, and the warning says "investigate the
alternative", not "do not do this". It exists because choosing Ceph *to avoid
using a cloud storage service* is how teams end up paying far more for less
durability.

## Generated artifacts

`emitBundle()` turns a finished plan into the files a request needs. Pure, so the same
input always yields the same bytes and the wizard can preview exactly what would be
published.

| File | When |
| --- | --- |
| `plan.md` | Always. What was asked for, the comparison, the cost with provenance, the networking |
| `catalog-info.yaml` | Always. A Backstage Component for the namespace |
| `manifests/00-namespace.yaml` | Always |
| `manifests/10-resourcequota.yaml` | Always. Quota and LimitRange, capped at exactly what was costed |
| `manifests/20-networkpolicies.yaml` | Always. Every generated policy, caveats as comments |
| `manifests/30-machineset.yaml` | Classic ARO only -- HCP pools are declared in the tfvars |
| `<name>.tfvars` | Dedicated cluster only |

The absences are the point. A shared namespace and an on-premises request get no tfvars,
because neither creates infrastructure. The tfvars targets exactly one Terraform module
and states all four `create_*` flags explicitly -- `andys-demo-cluster-tf` shares one
state across ROSA, ARO, ARO HCP and OSD, so a file that omits a flag plans a destroy
against whatever that flag defaults to.

The classic-ARO MachineSet carries `REPLACE_ME` placeholders for the infrastructure ID
and image, which do not exist until the cluster does. A guessed infrastructure ID
applies cleanly and then silently creates no machines, so the file says how to fill them
in instead.

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
  src/operators.ts               Approved operators and their capacity
  src/odf.ts                     ODF node minimums, replication, the warning
  src/objectStorage.ts           Azure Blob graduated bands
  src/azurePrices.ts             Retail Prices API client (server-side only)
  src/emit/                      plan.md, tfvars and manifests from a finished plan
  src/cli.ts                     yarn estimate
plugins/aro-planner-backend/     Backstage backend plugin
  src/router.ts                  /plan, /skus, /operators, shared price cache
  src/operatorHub.ts             Live OperatorHub lookup, the only kube call
  src/mcp.ts                     MCP tools, in-pod callers only
  src/assistant/                 In-page assistant: tool loop and form actions
plugins/aro-planner/             Backstage frontend plugin: the wizard
```

All pure logic lives in `aro-planner-common` so the wizard, the backend and the MCP server import the same functions and cannot disagree about a number.

## Notes

* **`FROM scratch` is mandatory for the plugin image.** RHDH's installer takes `manifest['layers'][0]` and treats that single layer as the plugin tarball. Any base image puts its own filesystem in layer 0, the plugin is never found, and the install reports success while leaving an empty directory.
* **The `!<plugin-path>` suffix matters.** Without it RHDH auto-detects the path from the `io.backstage.dynamic-packages` OCI annotation, which only the RHDH CLI's own packager sets. Naming it explicitly lets an ordinary OpenShift build produce a usable image.
* **Match the CLI to the RHDH version** -- `@red-hat-developer-hub/cli@release-1.10`. `@latest` is 2.x and treats the scalprum config as legacy.
* The key under `dynamicPlugins.frontend` must equal `scalprum.name` in the plugin's `package.json`, or it is discovered and never loaded.
* **ARO licence meters are not under `serviceName eq 'Azure Red Hat OpenShift'`** -- that returns nothing. They live under `Virtual Machines Licenses` with a `productName` of `Azure Red Hat OpenShift <category>`.
* **A managed disk SKU returns three meters, not one** -- `E40 LRS Disk` ($153.60/mo), `E40 LRS Disk Mount` ($17.08/mo) and `E40 LRS Disk Operations` ($0.002/10K). Filtering on `unitOfMeasure eq '1/Month'` leaves the first two, and taking whichever arrives first priced a 2 TiB disk below a 512 GiB one. Match on `meterName`.
* **Storage is billed per provisioned tier, not per GiB.** A 300 GiB PVC is an Azure P20 and bills as 512 GiB. Capacity is bought in whole units like nodes, so a per-GiB estimate understates every request not already on a tier boundary.
* **A VM SKU query returns six rows, not one** -- Linux and Windows, each in standard, Spot and Low Priority. Spot is $0.085/hr against $0.46 on-demand, so taking the wrong row understates a cluster fivefold.
* The OData filter fails between 15 and 18 `armSkuName` clauses, and the endpoint rate-limits with 429. Requests are chunked at 12 and retried; a 400 is never retried.
* The Retail Prices API sends **no CORS headers**, so pricing must run server-side.
* **The Blob "Data Stored" meter is graduated, and the API returns one row per band.** Three rows come back with the same `meterId`, distinguished only by `tierMinimumUnits` (0, 51200, 512000). Taking the first row overcharges above 50 TB; taking the last undercharges below it. Both are wrong and neither looks wrong.
* **`General Block Blob v2` and the legacy `Blob Storage` publish identically named meters** at slightly different prices, so matching on `meterName` alone returns both and the result depends on arrival order. The same trap as the disk meters and Spot VM pricing - several plausible rows, one correct.
* **ODF node candidates have to be priced separately from the workload profile.** They are sized by ODF's own 16 vCPU / 64 GiB minimum, not by the profile, so a memory-heavy request would otherwise filter the general-purpose sizes out of the price query and ODF would silently cost nothing - the worst possible failure for a comparison about cost.
* **A PackageManifest cannot tell you what an operator costs in capacity.** `currentCSVDesc` carries `annotations`, `description`, `installModes`, CRDs, `version` and little else — no deployment spec, no resource requests. The operand is worse: three Kafka brokers exist only in a CR nobody has created yet. So the live catalog answers "is this installable here", and the footprints stay curated. The half that most needs to be accurate is exactly the half the API cannot supply.
* **RHDH mounts no ServiceAccount token by default**, and the Deployment is operator-managed, so `automountServiceAccountToken` has to go through `spec.deployment.patch` on the `Backstage` CR. Editing the Deployment directly is reverted.
* **`oc get packagemanifest -o json` shows channels in catalog order, not preference order.** Reading `channels[0]` returned RHBK 22.0.13 while the default channel was on 26.6.7. Match on `status.defaultChannel`.
* The MCP endpoint only accepts in-pod callers, checked on the TCP peer address. The assistant sidecar shares the pod; an `Origin` header would be forgeable. It refuses to serve at all if Express `trust proxy` is ever enabled, since that would make `X-Forwarded-For` -- and therefore the peer address -- caller-controlled.
* **The in-page assistant endpoint is the opposite case.** It is called by a browser, so it must be reachable through the Route. That is why it is off unless configured, rather than restricted by address.
* `@aro-planner/common` has no runtime dependencies, because it is embedded wholesale into the frontend bundle. That is why the YAML emitter is 120 lines of our own rather than `js-yaml`.

## Related Demos

* **[Red Hat Developer Hub](../demo-developer-hub)** -- the RHDH instance this plugs into.

## Clean Up

```bash
oc -n rhdh delete bc/aro-planner is/aro-planner secret/quay-push
rm -rf node_modules packages/*/dist plugins/*/dist plugins/*/dist-dynamic plugin-registry dist-types
```
