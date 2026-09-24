# Hybrid Multi-Cluster Management with ACM

Manage an on-premises OpenShift cluster from a ROSA hub using Advanced Cluster Management (ACM). Demonstrates cluster import, governance policies, and application deployment via ManifestWork.

## Architecture

```
┌──────────────────────────────────────────────┐
│              ROSA Hub Cluster                │
│                                              │
│  ┌────────────────────┐  ┌────────────────┐  │
│  │  MultiClusterHub   │  │  Governance    │  │
│  │  (ACM 2.17)        │  │  Policies      │  │
│  └────────┬───────────┘  └───────┬────────┘  │
│           │                      │           │
│  ┌────────▼──────────────────────▼────────┐  │
│  │           ACM Console                  │  │
│  │  - Cluster overview                    │  │
│  │  - Policy compliance                   │  │
│  │  - ManifestWork status                │  │
│  └────────┬───────────────────────────────┘  │
│           │                                  │
└───────────┼──────────────────────────────────┘
            │ HTTPS (port 6443)
            │
┌───────────▼──────────────────────────────────┐
│         On-Prem OpenShift Cluster            │
│                                              │
│  ┌─────────────────┐  ┌──────────────────┐   │
│  │  Klusterlet      │  │  Policy Agent    │   │
│  │  (ACM agent)     │  │  (enforcement)   │   │
│  └─────────────────┘  └──────────────────┘   │
│                                              │
│  ┌─────────────────┐                         │
│  │  chatty-app     │  (deployed via ACM)     │
│  └─────────────────┘                         │
└──────────────────────────────────────────────┘
```

## Prerequisites

- **ROSA cluster** with `oc` CLI and cluster-admin access
- **On-prem OpenShift cluster** (4.17+) with:
  - `oc` CLI and cluster-admin access
  - Outbound HTTPS to ROSA API server (port 6443)

## Kubeconfig Setup

This demo requires switching between two clusters. Set up your kubeconfigs at the start:

```bash
export KUBECONFIG_HUB=<path-to-rosa-kubeconfig>
export KUBECONFIG_ONPREM=<path-to-onprem-kubeconfig>
```

Commands in **Part A**, **Part C**, and **Part D** target the hub (ROSA) cluster — use `KUBECONFIG=$KUBECONFIG_HUB`.
Commands in **Part B step 3** target the on-prem cluster — use `KUBECONFIG=$KUBECONFIG_ONPREM`.

## Part A: Install ACM on ROSA

### 1. Install the ACM operator

```bash
oc apply -f hub/acm-namespace.yaml
oc apply -f hub/acm-sub.yaml

# Wait for the ACM operator (not other operators in the namespace)
oc get csv -n open-cluster-management -w
# Look for: advanced-cluster-management.v2.17.x  Succeeded
```

### 2. Create the MultiClusterHub

```bash
oc apply -f hub/multiclusterhub.yaml

# This takes ~7-10 minutes
oc get multiclusterhub -n open-cluster-management -w
```

Wait until the status shows `Running`.

## Part B: Import the On-Prem Cluster

### 1. Create the ManagedCluster on the hub

```bash
oc apply -f import/managed-cluster-onprem.yaml
oc apply -f import/klusterlet-addon.yaml
```

### 2. Extract the import manifests

Wait a few seconds for the import secret to be created, then:

```bash
oc get secret onprem-import -n onprem -o jsonpath='{.data.crds\.yaml}' | base64 -d > /tmp/onprem-import-crds.yaml
oc get secret onprem-import -n onprem -o jsonpath='{.data.import\.yaml}' | base64 -d > /tmp/onprem-import.yaml
```

### 3. Apply on the on-prem cluster

```bash
KUBECONFIG=$KUBECONFIG_ONPREM oc apply -f /tmp/onprem-import-crds.yaml
KUBECONFIG=$KUBECONFIG_ONPREM oc apply -f /tmp/onprem-import.yaml
```

### 4. Verify the import

```bash
# Wait for JOINED=True and AVAILABLE=True
oc get managedcluster onprem -w
```

## Part C: Governance Policies

### 1. Bind the default ManagedClusterSet

Placements require a `ManagedClusterSetBinding` in the namespace where policies live. Without this, the Placement will report "No valid ManagedClusterSetBindings found" and policies won't propagate:

```bash
oc apply -f policies/clusterset-binding.yaml
```

### 2. Apply policies

```bash
oc apply -f policies/policy-logging-operator.yaml
oc apply -f policies/policy-clf-configured.yaml
oc apply -f policies/policy-no-privileged-pods.yaml
oc apply -f policies/policy-resource-quotas.yaml
oc apply -f policies/placement.yaml
```

### What each policy does

| Policy | Mode | Effect |
|--------|------|--------|
| `policy-logging-operator` | Enforce | Installs the Cluster Logging Operator on all managed clusters |
| `policy-clf-configured` | Inform | Reports whether a ClusterLogForwarder exists (audit only) |
| `policy-no-privileged-pods` | Inform | Reports any privileged pods in user namespaces (audit only) |
| `policy-resource-quotas` | Enforce | Creates ResourceQuotas on the `default` namespace |

### 3. Verify compliance

```bash
# Wait ~30 seconds for policy propagation
oc get policy -n open-cluster-management \
  -o custom-columns='NAME:.metadata.name,MODE:.spec.remediationAction,STATUS:.status.compliant'
```

Expected: `policy-logging-operator`, `policy-clf-configured`, and `policy-resource-quotas` show `Compliant`. `policy-no-privileged-pods` shows `NonCompliant` (expected — some system pods run privileged).

Open the ACM console → **Governance → Policies** to see compliance per cluster.

## Part D: Application Deployment via ACM

Deploy a chatty app to both clusters — directly on the hub, and via ManifestWork to the on-prem cluster:

```bash
# Deploy on hub
oc apply -f apps/chatty-app-hub.yaml

# Deploy to on-prem via ManifestWork
oc apply -f apps/chatty-app-manifestwork.yaml
```

### Verify

```bash
# Hub
oc get pods -n chatty-app

# On-prem (via ManifestWork status)
oc get manifestwork chatty-app -n onprem

# Or directly on on-prem
KUBECONFIG=$KUBECONFIG_ONPREM oc get pods -n chatty-app
```

## Part E: Multi-Cluster Observability (Optional)

ACM Observability aggregates metrics from all managed clusters into a central Thanos instance. This requires an S3 bucket.

### 1. Create the object storage secret

Edit `hub/observability-secret.yaml` with your S3 bucket details, then apply:

```bash
oc apply -f hub/observability-secret.yaml
```

### 2. Enable observability

```bash
oc apply -f hub/multiclusterobservability.yaml

# Wait for pods (~5 minutes)
oc get pods -n open-cluster-management-observability -w
```

### 3. View metrics

Open the ACM console → **Infrastructure → Clusters**. Each cluster shows CPU, memory, and other metrics.

Grafana dashboards are at the `grafana` Route in `open-cluster-management-observability`.

## Clean Up

### Remove apps

```bash
oc delete -f apps/chatty-app-manifestwork.yaml
oc delete -f apps/chatty-app-hub.yaml
```

### Remove policies

```bash
oc delete -f policies/placement.yaml
oc delete -f policies/policy-resource-quotas.yaml
oc delete -f policies/policy-no-privileged-pods.yaml
oc delete -f policies/policy-clf-configured.yaml
oc delete -f policies/policy-logging-operator.yaml
oc delete -f policies/clusterset-binding.yaml
```

### Remove the on-prem managed cluster

```bash
oc delete managedcluster onprem
```

This automatically removes the klusterlet from the on-prem cluster.

### Remove observability (if enabled)

```bash
oc delete -f hub/multiclusterobservability.yaml
oc delete -f hub/observability-secret.yaml
```

### Remove ACM

```bash
oc delete -f hub/multiclusterhub.yaml
# Wait for MCH deletion to complete
oc get multiclusterhub -n open-cluster-management -w
oc delete -f hub/acm-sub.yaml
oc delete -f hub/acm-namespace.yaml
```

## Troubleshooting

**ManagedCluster stuck in `Pending`**: Ensure the on-prem cluster can reach the ROSA API server on port 6443. Check: `curl -k https://<rosa-api-url>:6443/healthz` from the on-prem cluster.

**Policies not propagating**: The most common cause is a missing `ManagedClusterSetBinding`. Apply `policies/clusterset-binding.yaml` and check `oc get placement all-managed-clusters -n open-cluster-management -o jsonpath='{.status.numberOfSelectedClusters}'`.

**ACM CSV check picks up wrong operator**: The `open-cluster-management` namespace may contain other operator CSVs (authorino, limitador, etc.) from sub-operators. When waiting for the ACM CSV, filter by name: `oc get csv -n open-cluster-management | grep advanced-cluster-management`.

**Observability addon not reporting**: Check `oc get pods -n open-cluster-management-addon-observability` on the on-prem cluster.
