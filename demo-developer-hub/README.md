# Red Hat Developer Hub on ROSA/ARO

This demo installs Red Hat Developer Hub (RHDH) and proves the self-service golden path end to end: a developer fills in a form, RHDH renders manifests and opens a pull request for the platform team to review.

It is the foundation for two demos that build on it:

* **[RHDH Lightspeed with a custom MCP server](../demo-rhdh-lightspeed-with-custom-mcp)** -- enables the assistant, backed by your own self-hosted model, and teaches it new tools via MCP.
* **[Developer Tooling Dashboard](../developer-tooling-dashboard)** -- a live-costed ARO cluster planner.

## Overview

* **RHDH 1.10.5** -- installed via OLM from the standard `redhat-operators` catalog.
* **Software catalog** -- two teams, a sample system and component.
* **One Scaffolder template** -- `Request a namespace`, which renders a Namespace plus a default-deny NetworkPolicy baseline and opens a GitHub PR.
* **Guest sign-in** -- no identity provider needed to demo it.
* **No assistant** -- deliberately disabled here; see the Lightspeed demo.

## Why 1.10 and not 2.x

RHDH 2.x exists (`release-2.1` is active upstream) and renames Lightspeed to Intelligent Assistant. It is **not installable on ROSA HCP**, for two compounding reasons:

1. The 2.x images were never promoted to `registry.redhat.io` -- that repository returns zero tags from the Red Hat container catalog API, and the operator pod fails with `manifest unknown` (not an auth error; ROSA's pull secret does carry Red Hat credentials). The images exist only on `quay.io/rhdh`.
2. Redirecting them needs an `ImageDigestMirrorSet`, which ROSA HCP refuses:

   ```
   ValidatingAdmissionPolicy 'mirror' denied request: This resource cannot be created,
   updated, or deleted. Please ask your administrator to modify the resource in the
   HostedCluster object.
   ```

   That object belongs to Red Hat SRE, not the customer.

Crucially, **nothing we need is missing from 1.10**. The Lightspeed flavour in 1.10.5 ships the MCP tool runtime (`remote::model-context-protocol`) and an `mcp_servers` registration block byte-identical to the one in the 2.1 examples, so custom MCP servers work exactly the same. The only real 2.x gain is RAG grounding: 2.x can retarget the Offline Knowledge Portal with a `chunk_filter_query`, where 1.10 pins a fixed `rhdh-rag-content-rhel9` image scoped to RHDH product docs.

When 2.x reaches `registry.redhat.io`, the port is small: the flavour name (`lightspeed` -> `intelligent-assistant`), the plugin package name, and the `lightspeed-stack.yaml` shape.

## Prerequisites

* A ROSA, ARO or OSD cluster with `cluster-admin`. Verified on ROSA HCP, OpenShift 4.22.12.
* `oc` CLI, logged in.
* A GitHub personal access token with `repo` and `workflow` scopes, so the Scaffolder can open PRs.

Build a cluster with `../andys-demo-cluster-tf` if you need one -- `basic_rosa.tfvars` or `basic_aro_hcp.tfvars` are both fine. This demo does not care which provider it runs on.

## How to Run the Demo

### 1. Install the operator

RHDH 1.10 is in the catalog OpenShift already ships, so there is no CatalogSource to create:

```bash
oc apply -f operator/subscription.yaml
```

The Subscription uses channel `fast-1.10` rather than `fast`, so the cluster stays on the 1.10 stream and will not jump to 2.x the moment that reaches the catalog.

Wait for the CSV:

```bash
oc get csv -n rhdh-operator
# NAME                   DISPLAY                          VERSION   PHASE
# rhdh-operator.v1.10.5  Red Hat Developer Hub Operator   1.10.5    Succeeded
```

### 2. Create the secrets

Do this from the CLI rather than editing `secrets/rhdh-secrets.yaml`, so nothing sensitive is written into the repo:

```bash
oc create namespace rhdh

oc -n rhdh create secret generic rhdh-secrets \
  --from-literal=BACKEND_SECRET="$(openssl rand -base64 24)" \
  --from-literal=GITHUB_TOKEN="${GITHUB_TOKEN}" \
  --from-literal=GITHUB_ORG="andyrepton" \
  --from-literal=GITHUB_REPO="managed-openshift-demos" \
  --from-literal=CATALOG_BRANCH="main"
```

`CATALOG_BRANCH` is the branch the catalog is read from. Point it at a feature branch to verify catalog or template changes before merging, without editing `app-config-rhdh.yaml`:

```bash
oc -n rhdh patch secret rhdh-secrets \
  -p '{"stringData":{"CATALOG_BRANCH":"feat/my-branch"}}'
oc -n rhdh rollout restart deployment/backstage-developer-hub
```

`secrets/rhdh-secrets.yaml` exists as a reference for the shape of the Secret, with `REPLACE_ME` placeholders. Do not commit a filled-in copy.

### 3. Apply the configuration

```bash
oc apply -f app-config/app-config-rhdh.yaml
oc apply -f app-config/dynamic-plugins.yaml
```

* `app-config-rhdh.yaml` -- GitHub integration, guest auth, and the catalog location pointing at `catalog/all.yaml` in this repo.
* `dynamic-plugins.yaml` -- starts from `dynamic-plugins.default.yaml`. The commented-out block near the bottom is where the `aro-planner` plugin gets wired in later.

### 4. Deploy RHDH

```bash
oc apply -f backstage.yaml
oc -n rhdh rollout status deployment/backstage-developer-hub --timeout=10m
```

Then open it:

```bash
# The operator names both the Deployment and the Route "backstage-<cr-name>".
echo "https://$(oc get route backstage-developer-hub -n rhdh -o jsonpath='{.spec.host}')"
```

Sign in as **Guest**.

### 5. Verify the golden path

1. Go to **Catalog** -- you should see `payments-api`, the `payments` system and two groups. If the catalog is empty, the location in `app-config-rhdh.yaml` could not be fetched; check the GitHub token and that your changes to `catalog/` are pushed.
2. Go to **Create** and run **Request a namespace**. Enter a name like `payments-dev` and pick an owner.
3. The template should finish with a link to a real pull request against this repo, adding `requested-namespaces/payments-dev/` with a Namespace and the NetworkPolicy baseline.

If that PR appears, the GitHub integration, the Scaffolder and the catalog are all wired correctly -- which is the prerequisite for everything built on top of this demo.

## What gets created

| Path | Purpose |
| --- | --- |
| `operator/subscription.yaml` | Namespace, OperatorGroup and Subscription (channel `fast-1.10`) |
| `secrets/rhdh-secrets.yaml` | Reference shape for the Secret (placeholders only) |
| `app-config/app-config-rhdh.yaml` | Auth, GitHub integration, catalog locations |
| `app-config/dynamic-plugins.yaml` | Dynamic plugin set; wiring point for later demos |
| `backstage.yaml` | The `Backstage` CR (`rhdh.redhat.com/v1alpha5`) |
| `catalog/` | Sample entities and the `namespace-request` template |
| `catalog/skeleton/` | Files the template renders into the PR |

## Notes

* The CR uses `rhdh.redhat.com/v1alpha5`. The 1.10.5 CRD serves `v1alpha4` and `v1alpha5`, with `v1alpha5` as the storage version -- it is the one that carries `spec.flavours`.
* The operator enables the `lightspeed` flavour by default, which adds an `init-rag-data` init container and a `lightspeed-core` sidecar to the pod. `backstage.yaml` explicitly disables it so this demo is plain RHDH; the Lightspeed demo turns it back on and gives it a model.
* `enableLocalDb: true` means the operator runs PostgreSQL for you. Use an external database for anything you care about keeping.
* Guest sign-in is enabled with `dangerouslyAllowOutsideDevelopment: true`. Swap in the GitHub or OIDC auth provider before showing this to anyone who might mistake it for production.
* The catalog location points at `main` in this repo. If you are iterating on `catalog/`, push your changes -- RHDH reads from GitHub, not from your laptop.

## Cleaning Up

```bash
oc delete -f backstage.yaml
oc delete -f app-config/dynamic-plugins.yaml -f app-config/app-config-rhdh.yaml
oc -n rhdh delete secret rhdh-secrets
oc delete -f operator/subscription.yaml
oc delete namespace rhdh
```
