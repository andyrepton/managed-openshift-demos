# Red Hat Developer Hub on ROSA/ARO

Install Red Hat Developer Hub (RHDH) 1.10 and demonstrate the self-service golden path: a developer fills in a form, RHDH renders manifests and opens a pull request for the platform team to review.

## Overview

* **RHDH 1.10.5** -- installed via OLM from the standard `redhat-operators` catalog.
* **Software catalog** -- two teams, a sample system and component, loaded from this repo.
* **Scaffolder template** -- `Request a namespace` renders a Namespace plus a default-deny NetworkPolicy baseline and opens a GitHub PR.
* **Guest sign-in** -- no identity provider required.

Verified on ROSA HCP, OpenShift 4.22.12.

## Prerequisites

* A ROSA, ARO or OSD cluster with `cluster-admin`. Build one with `../andys-demo-cluster-tf` using `basic_rosa.tfvars` or `basic_aro_hcp.tfvars` -- this demo is provider-agnostic.
* `oc` CLI, logged in.
* A GitHub personal access token with `repo` and `workflow` scopes.

## How to Run the Demo

### 1. Install the operator

RHDH 1.10 ships in the catalog OpenShift already has, so there is no CatalogSource to create:

```bash
oc apply -f operator/subscription.yaml
```

Wait for the CSV:

```bash
oc get csv -n rhdh-operator
# NAME                   DISPLAY                          VERSION   PHASE
# rhdh-operator.v1.10.5  Red Hat Developer Hub Operator   1.10.5    Succeeded
```

### 2. Create the secrets

```bash
oc create namespace rhdh

oc -n rhdh create secret generic rhdh-secrets \
  --from-literal=BACKEND_SECRET="$(openssl rand -base64 24)" \
  --from-literal=GITHUB_TOKEN="${GITHUB_TOKEN}" \
  --from-literal=GITHUB_ORG="andyrepton" \
  --from-literal=GITHUB_REPO="managed-openshift-demos" \
  --from-literal=CATALOG_BRANCH="main"
```

`secrets/rhdh-secrets.yaml` documents the shape of the Secret with `REPLACE_ME` placeholders. Do not commit a filled-in copy.

### 3. Apply the configuration

```bash
oc apply -f app-config/app-config-rhdh.yaml
oc apply -f app-config/dynamic-plugins.yaml
```

### 4. Deploy RHDH

```bash
oc apply -f backstage.yaml
oc -n rhdh rollout status deployment/backstage-developer-hub --timeout=10m

echo "https://$(oc get route backstage-developer-hub -n rhdh -o jsonpath='{.spec.host}')"
```

Sign in as **Guest**.

### 5. Verify the golden path

1. Open **Catalog**. You should see `payments-api`, the `payments` system and two groups.
2. Open **Create** and run **Request a namespace**. Enter a namespace name, pick an owner and choose a target repository.
3. The template finishes with a link to a pull request adding `requested-namespaces/<name>/` with a Namespace and the NetworkPolicy baseline.

## What gets created

| Path | Purpose |
| --- | --- |
| `operator/subscription.yaml` | Namespace, OperatorGroup and Subscription (channel `fast-1.10`) |
| `secrets/rhdh-secrets.yaml` | Reference shape for the Secret (placeholders only) |
| `app-config/app-config-rhdh.yaml` | Auth, GitHub integration, catalog locations |
| `app-config/dynamic-plugins.yaml` | Dynamic plugin set |
| `backstage.yaml` | The `Backstage` CR (`rhdh.redhat.com/v1alpha5`) |
| `catalog/` | Sample entities and the `namespace-request` template |
| `catalog/skeleton/` | Files the template renders into the PR |

## Notes

* **Pinned to 1.10, not 2.x.** RHDH 2.x images are published only to `quay.io/rhdh` and not to `registry.redhat.io`, so the operator pod fails with `manifest unknown`. Redirecting them needs an `ImageDigestMirrorSet`, which ROSA HCP does not permit. 1.10 is not missing anything required here -- its `lightspeed` flavour already provides the MCP tool runtime and `mcp_servers` block.
* **The GitHub Scaffolder module ships disabled.** RHDH preinstalls `backstage-plugin-scaffolder-backend-module-github` but leaves it off. Without the `disabled: false` entry in `dynamic-plugins.yaml`, templates render their files and then fail with `Template action with ID 'publish:github:pull-request' is not registered`. Enabling it takes the registered action count from 17 to 30.
* **Do not use a `/` in a branch name set as `CATALOG_BRANCH`.** Backstage parses the ref in `/blob/<ref>/<path>` as a single path segment, so `feat/my-branch` resolves as ref `feat` with the remainder read as a directory. Use `feat-my-branch`. `main` is unaffected.
* `CATALOG_BRANCH` lets you verify catalog changes on a branch before merging without editing `app-config-rhdh.yaml`:
  ```bash
  oc -n rhdh patch secret rhdh-secrets -p '{"stringData":{"CATALOG_BRANCH":"feat-my-branch"}}'
  oc -n rhdh rollout restart deployment/backstage-developer-hub
  ```
* The operator names both the Deployment and the Route `backstage-<cr-name>`.
* The CR uses `rhdh.redhat.com/v1alpha5`. The 1.10.5 CRD serves `v1alpha4` and `v1alpha5`; `v1alpha5` is the storage version and the one carrying `spec.flavours`.
* The operator enables the `lightspeed` flavour by default, adding an `init-rag-data` init container and a `lightspeed-core` sidecar. `backstage.yaml` disables it so this demo is plain RHDH.
* `enableLocalDb: true` means the operator runs PostgreSQL. Use an external database for anything persistent.
* Guest sign-in uses `dangerouslyAllowOutsideDevelopment: true`. Swap in GitHub or OIDC auth before showing this as a production pattern.

## Related Demos

* **[ARO Cluster Planner](../demo-aro-cluster-planner)** -- a self-service ARO sizing and costing wizard that runs as a plugin inside this RHDH instance.

## Clean Up

```bash
oc delete -f backstage.yaml
oc delete -f app-config/dynamic-plugins.yaml -f app-config/app-config-rhdh.yaml
oc -n rhdh delete secret rhdh-secrets
oc delete -f operator/subscription.yaml
oc delete namespace rhdh
```
