# Hybrid Centralized Logging: On-Prem to ROSA

Centralize logs from an on-premises OpenShift cluster into a ROSA cluster running LokiStack, giving a single pane of glass for log search across hybrid infrastructure.

## Architecture

```
┌─────────────────────────┐         ┌──────────────────────────────────┐
│   On-Prem OpenShift     │         │         ROSA Cluster             │
│                         │         │                                  │
│  ┌─────────────────┐    │  HTTPS  │  ┌───────────┐   ┌───────────┐  │
│  │ Vector Collector │────┼────────►│  │ Loki GW   │──►│ LokiStack │  │
│  │ (CLF)           │    │ Bearer  │  │ (Route)   │   │ (S3)      │  │
│  └────────┬────────┘    │  Token  │  └───────────┘   └─────┬─────┘  │
│           │             │         │                        │        │
│  ┌────────▼────────┐    │         │  ┌─────────────────────▼─────┐  │
│  │ chatty-app      │    │         │  │ OpenShift Console Logs UI │  │
│  │ (onprem logs)   │    │         │  │ (filter by cluster_id)    │  │
│  └─────────────────┘    │         │  └───────────────────────────┘  │
│                         │         │                                  │
│                         │         │  ┌─────────────────┐             │
│                         │         │  │ Vector Collector │             │
│                         │         │  │ (local CLF)     │             │
│                         │         │  └────────┬────────┘             │
│                         │         │  ┌────────▼────────┐             │
│                         │         │  │ chatty-app      │             │
│                         │         │  │ (rosa logs)     │             │
│                         │         │  └─────────────────┘             │
└─────────────────────────┘         └──────────────────────────────────┘
```

Both clusters' Vector collectors automatically tag logs with `openshift.cluster_id`, so you can filter by cluster in the Loki UI without any custom configuration.

## Prerequisites

- **ROSA cluster** with:
  - LokiStack infrastructure provisioned (S3 bucket with **AES256** encryption + IAM role via `andys-demo-cluster-tf` lokistack module)
  - `oc` CLI with cluster-admin access
- **On-prem OpenShift cluster** (4.17+) with:
  - `oc` CLI with cluster-admin access
  - Outbound HTTPS access to ROSA ingress domain

## Kubeconfig Setup

This demo requires switching between two clusters. Set up your kubeconfigs at the start:

```bash
export KUBECONFIG_HUB=<path-to-rosa-kubeconfig>
export KUBECONFIG_ONPREM=<path-to-onprem-kubeconfig>
```

Commands in **Part A** and **Part C** target the hub (ROSA) cluster — use `KUBECONFIG=$KUBECONFIG_HUB`.
Commands in **Part B** target the on-prem cluster — use `KUBECONFIG=$KUBECONFIG_ONPREM`.

## Part A: ROSA Setup

All commands in this section target the **ROSA cluster**.

### 1. Install the operators

```bash
# Loki Operator (into openshift-operators-redhat)
oc apply -f rosa/loki-operator-ns.yaml
oc apply -f rosa/loki-operator-og.yaml
oc apply -f rosa/loki-operator-sub.yaml

# Cluster Logging Operator (into openshift-logging)
oc apply -f rosa/logging-operator-ns.yaml
oc apply -f rosa/logging-operator-og.yaml
oc apply -f rosa/logging-operator-sub.yaml

# Wait for both operators
oc get csv -n openshift-operators-redhat -w
oc get csv -n openshift-logging -w
```

### 2. Create the S3 credentials secret and deploy LokiStack

The lokistack TF module from `andys-demo-cluster-tf` outputs the required values:

```bash
oc -n openshift-logging create secret generic logging-loki-aws \
  --from-literal=bucketnames="<BUCKET_NAME>" \
  --from-literal=region="<REGION>" \
  --from-literal=audience="openshift" \
  --from-literal=role_arn="<ROLE_ARN>"

oc apply -f rosa/lokistack.yaml

# Wait for LokiStack to be ready
oc get lokistack logging-loki -n openshift-logging -w
```

### 3. Deploy collector RBAC, CLF, Route, and Logs UI

```bash
# Collector SA with read + write RBAC
oc apply -f rosa/collector-sa-rbac.yaml

# On-prem forwarder SA with write RBAC
oc apply -f rosa/forwarder-sa-rbac.yaml

# Local log collection into LokiStack
oc apply -f rosa/clf-rosa.yaml

# Expose Loki gateway for external ingest
CLUSTER_DOMAIN=$(oc get ingresses.config.openshift.io cluster -o jsonpath='{.spec.domain}')
sed "s/REPLACE_WITH_CLUSTER_DOMAIN/${CLUSTER_DOMAIN}/" rosa/loki-route.yaml | oc apply -f -

# Enable the Logs tab in the OpenShift Console (requires Cluster Observability Operator)
oc apply -f rosa/logging-uiplugin.yaml

# Grant log viewing permissions to admin users
oc apply -f rosa/logging-view-rbac.yaml
```

### 4. Generate the on-prem forwarder token

```bash
ONPREM_TOKEN=$(oc create token onprem-forwarder -n openshift-logging --duration=8760h)
echo "${ONPREM_TOKEN}"
# Save this token -- you need it for Part B step 3.
```

### 5. Deploy the chatty app

```bash
oc apply -f rosa/chatty-app.yaml
```

## Part B: On-Prem Setup

All commands in this section target the **on-prem cluster** — prefix commands with `KUBECONFIG=$KUBECONFIG_ONPREM`.

### 1. Install the Cluster Logging Operator

Only the Cluster Logging Operator is needed (no Loki Operator, since logs are forwarded to ROSA):

```bash
oc apply -f onprem/logging-operator-ns.yaml
oc apply -f onprem/logging-operator-og.yaml
oc apply -f onprem/logging-operator-sub.yaml

# Wait for operator
oc get csv -n openshift-logging -w
```

### 2. Create the collector ServiceAccount and RBAC

```bash
oc apply -f onprem/collector-sa-rbac.yaml
```

### 3. Create the bearer token secret and deploy CLF

The bearer token secret must be created separately from the CLF manifest — bundling it in the same file causes `oc apply` to overwrite the real token with a placeholder on re-apply.

```bash
# Create the bearer token secret (use the token from Part A step 4)
oc -n openshift-logging create secret generic loki-rosa-bearer-token \
  --from-literal=token="<ONPREM_TOKEN>"

# Deploy the CLF with the ROSA domain substituted
ROSA_DOMAIN="<your-rosa-apps-domain>"  # e.g. apps.rosa.xxxxx.xxxx.p3.openshiftapps.com
sed "s/REPLACE_WITH_ROSA_DOMAIN/${ROSA_DOMAIN}/g" onprem/clf-onprem.yaml | oc apply -f -
```

### 4. Deploy the chatty app

```bash
oc apply -f onprem/chatty-app.yaml
```

## Part C: Verify

### Check collector pods

```bash
# ROSA
oc get pods -n openshift-logging -l app.kubernetes.io/component=collector

# On-prem
oc get pods -n openshift-logging -l app.kubernetes.io/component=collector
```

### Check on-prem collector logs for errors

```bash
# Should show only benign "file too small" warnings, no auth or TLS errors
oc logs -n openshift-logging -l app.kubernetes.io/component=collector --tail=20
```

### View centralized logs

Open the ROSA OpenShift Console → **Observe → Logs**.

To query both clusters' chatty app logs:

```
{kubernetes_namespace_name=~"chatty-app-.*"}
```

To see infrastructure logs from all nodes (both ROSA and on-prem hosts will appear):

Switch to **infrastructure** log type — you'll see ROSA nodes (e.g. `ip-10-0-*`) and on-prem nodes (e.g. `compute-0`, `master-0`) side by side.

### Verify via Loki API

```bash
TOKEN=$(oc whoami -t)
CLUSTER_DOMAIN=$(oc get ingresses.config.openshift.io cluster -o jsonpath='{.spec.domain}')
LOKI_URL="https://loki-gateway.${CLUSTER_DOMAIN}"

# Application namespaces (should include chatty-app-rosa AND chatty-app-onprem)
curl -s -H "Authorization: Bearer ${TOKEN}" \
  "${LOKI_URL}/api/logs/v1/application/loki/api/v1/label/kubernetes_namespace_name/values" | python3 -m json.tool

# Infrastructure hosts (should include both ROSA and on-prem nodes)
curl -s -H "Authorization: Bearer ${TOKEN}" \
  "${LOKI_URL}/api/logs/v1/infrastructure/loki/api/v1/label/kubernetes_host/values" | python3 -m json.tool
```

## Clean Up

### On-prem cluster

```bash
oc delete -f onprem/chatty-app.yaml
oc delete -f onprem/clf-onprem.yaml
oc delete secret loki-rosa-bearer-token -n openshift-logging
oc delete -f onprem/collector-sa-rbac.yaml
oc delete -f onprem/logging-operator-sub.yaml
oc delete -f onprem/logging-operator-og.yaml
oc delete -f onprem/logging-operator-ns.yaml
```

### ROSA cluster

```bash
oc delete -f rosa/chatty-app.yaml
oc delete -f rosa/logging-view-rbac.yaml
oc delete -f rosa/logging-uiplugin.yaml
oc delete -f rosa/clf-rosa.yaml
CLUSTER_DOMAIN=$(oc get ingresses.config.openshift.io cluster -o jsonpath='{.spec.domain}')
sed "s/REPLACE_WITH_CLUSTER_DOMAIN/${CLUSTER_DOMAIN}/" rosa/loki-route.yaml | oc delete -f -
oc delete -f rosa/forwarder-sa-rbac.yaml
oc delete -f rosa/collector-sa-rbac.yaml
oc delete -f rosa/lokistack.yaml
oc delete secret logging-loki-aws -n openshift-logging
oc delete -f rosa/logging-operator-sub.yaml
oc delete -f rosa/logging-operator-og.yaml
oc delete -f rosa/logging-operator-ns.yaml
oc delete -f rosa/loki-operator-sub.yaml
oc delete -f rosa/loki-operator-og.yaml
oc delete -f rosa/loki-operator-ns.yaml
```

## Troubleshooting

**On-prem collector 302/401 errors**: Verify the bearer token secret has the correct token value. If you re-applied the CLF manifest with `oc apply` while it contained a bundled Secret, it may have overwritten the real token. Delete and recreate the secret.

**S3 access denied on LokiStack**: The IAM trust policy must use SA name `logging-loki` (not `loki`) and audience `openshift` (not `sts.amazonaws.com`). The S3 bucket must use AES256 encryption (not aws:kms).

**Rate limiting (429)**: The `1x.demo` LokiStack size limits ingestion to 4MB/s. After initial deploy, both clusters' backlogged logs may exceed this limit temporarily. This self-resolves as the backlog drains.

**Token expired**: Regenerate with `oc create token onprem-forwarder -n openshift-logging --duration=8760h` on ROSA and recreate the secret on the on-prem cluster.

**"Missing permissions" for on-prem namespaces in Console**: The Loki OPA sidecar's default admin groups don't include `cluster-admins` (the ROSA/OSD admin group). Non-admin users fall through to namespace-level authorization, which filters by locally-existing namespaces — remote cluster namespaces get silently dropped, causing a 403. The `lokistack.yaml` manifest includes `adminGroups` with `cluster-admins` to work around this. If you see this error, verify the LokiStack has `spec.tenants.openshift.adminGroups` set correctly.
