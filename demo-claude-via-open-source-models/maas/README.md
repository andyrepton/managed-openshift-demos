# Models-as-a-Service (MaaS) for Claude Code on RHOAI

Enable Red Hat-native API key authentication, rate limiting, and usage tracking for vLLM model endpoints using RHOAI Models-as-a-Service.

> **Note**: MaaS is available in RHOAI 3.5. It is the recommended approach for model serving governance in OpenShift AI.

## Why MaaS

MaaS replaces LiteLLM's auth and usage tracking with a fully Red Hat-supported stack:

- **API key auth** via Kuadrant/Authorino
- **Per-user token quotas** via MaaSSubscription CRDs
- **Usage dashboards** via Prometheus/Grafana (User Workload Monitoring)
- **Self-service keys** from the OpenShift AI dashboard (Gen AI Studio)
- **GitOps-friendly** subscription management via CRDs

```
Claude Code --> LiteLLM --> MaaS Gateway --> vLLM --> Model
                            (auth + quota)
Cursor ----------------------^
                (direct, OpenAI API)
```

**Important**: MaaS supports both OpenAI and Anthropic API formats. Claude Code can connect to MaaS directly, but LiteLLM provides convenient model name aliasing (mapping `claude-opus-5` → `qwen3-8-27b` etc.). Cursor and other OpenAI-compatible tools can connect to MaaS directly.

## Prerequisites

- RHOAI 3.5+ installed
- OpenShift 4.19+
- Red Hat Connectivity Link (RHCL) operator installed (see Step 2, or copy `operator.yaml` to your operator install step)
- cert-manager operator installed (from base demo)
- Models downloaded to PVCs (from base demo)
- cluster-admin access

## Step 1: Enable User Workload Monitoring

MaaS uses Prometheus for usage tracking. Enable user workload monitoring if not already enabled:

```bash
oc apply -f monitoring.yaml
```

## Step 2: Install Red Hat Connectivity Link

RHCL provides Kuadrant (API gateway policy engine) which MaaS uses for authentication and rate limiting. This is a prerequisite — MaaS will not function without it.

```bash
oc apply -f operator.yaml

# Wait for the operator CSV to succeed
oc get csv -n openshift-operators | grep rhcl
# Should show "Succeeded"
```

> **Note**: A copy of this subscription is also available at `cluster-setup/operators/rhcl.yaml` for use in your operator installation step.

## Step 3: Create Kuadrant

```bash
oc apply -f kuadrant.yaml
oc wait --for=condition=Ready kuadrant/kuadrant -n kuadrant-system --timeout=300s
```

## Step 4: Set Up Authorino

Authorino handles API key validation. The service annotation triggers OpenShift service-ca to generate the TLS certificate:

```bash
oc apply -f authorino.yaml

# Verify
oc get authorino -n kuadrant-system
oc get secret authorino-server-cert -n kuadrant-system
```

## Step 5: Deploy PostgreSQL

MaaS stores API keys, subscriptions, and usage data in PostgreSQL. It must be running before enabling MaaS in the DSC.

Generate a password and update `postgres.yaml`:

```bash
PG_PASSWORD=$(openssl rand -base64 16 | tr -d '=+/')
echo "PostgreSQL password: $PG_PASSWORD"
# Replace BOTH instances of REPLACE_WITH_GENERATED_PASSWORD in postgres.yaml
```

Then apply:

```bash
oc apply -f postgres.yaml
oc wait --for=condition=Available deployment/postgres \
  -n redhat-ods-applications --timeout=120s
```

## Step 6: Label Namespaces and Create Gateway

The MaaS gateway uses namespace selectors. Both `redhat-ods-applications` **and** the model namespace (`claude-code-demo`) need the gateway access label:

```bash
oc apply -f namespace-label.yaml
oc apply -f gateway.yaml
oc wait --for=condition=Programmed gateway/maas-default-gateway \
  -n openshift-ingress --timeout=120s
```

## Step 7: Enable MaaS in the DataScienceCluster

Patch the existing DSC to enable the AI Gateway module. RHOAI 3.5 uses `spec.components.aigateway` (the older `kserve.modelsAsService` path is deprecated):

```bash
oc patch datasciencecluster default-dsc --type=merge \
  -p '{"spec":{"components":{"aigateway":{"managementState":"Managed","modelsAsAService":{"managementState":"Managed"}}}}}'
```

> **Important**: The top-level `aigateway.managementState` MUST be `Managed` — setting only the `modelsAsAService` sub-field is not enough.

Wait for the MaaS API to start:

```bash
oc get deployment maas-api -n redhat-ai-gateway-infra -w
```

After RHCL is installed and MaaS is enabled, restart the `llmisvc-controller-manager` so it picks up the new CRDs (it caches CRD discovery at startup):

```bash
oc rollout restart deployment/llmisvc-controller-manager -n redhat-ods-applications
```

## Step 8: Enable Gen AI Studio in the Dashboard

```bash
oc patch odhdashboardconfig odh-dashboard-config \
  -n redhat-ods-applications --type=merge \
  -p '{"spec":{"dashboardConfig":{"genAiStudio":true}}}'
```

## Step 9: Deploy Models as LLMInferenceServices

MaaS uses `LLMInferenceService` (not `InferenceService`). These are similar to the base demo's InferenceServices but include a `router.gateway.refs` section that connects them to the MaaS gateway. The model definitions live in the `models/` directory:

```bash
# If using MaaS, delete the existing InferenceServices first
oc delete inferenceservice granite-4-1-30b qwen3-8-27b -n claude-code-demo 2>/dev/null

# Deploy as LLMInferenceServices
oc apply -f ../models/granite-llm-inference-service.yaml
oc apply -f ../models/qwen3-8-llm-inference-service.yaml

# Wait for models to load
oc get llminferenceservice -n claude-code-demo -w
```

> **baseRef names**: LLMInferenceService requires `baseRefs` pointing to LLMInferenceServiceConfig presets. The available names differ between fresh installs and upgraded clusters — run `oc get llminferenceserviceconfig -A` to check. See the `CLAUDE.md` gotchas section for details.

## Step 10: Register Models and Create Access Policies

### On ROSA / standard OCP (OpenShift groups available)

```bash
# Register models with MaaS
oc apply -f model-refs.yaml

# Create auth policy granting access to the user group
oc apply -f auth-policy.yaml

# Create user group and add yourself
oc adm groups new claude-code-users
oc adm groups add-users claude-code-users $(oc whoami)

# Create subscription with token limits
oc apply -f subscription.yaml
```

### On ARO HCP (OpenShift groups not available)

ARO HCP uses Entra ID authentication — `oc adm groups` is not available. Use the `users` field in both the MaaSAuthPolicy and MaaSSubscription instead:

```bash
# Register models with MaaS
oc apply -f model-refs.yaml

# Create a ServiceAccount for API key creation
oc create serviceaccount maas-client -n claude-code-demo

# Apply auth policy and subscription (edit to uncomment the users field first)
oc apply -f auth-policy.yaml
oc apply -f subscription.yaml

# Patch both to add the ServiceAccount as a user
SA_USER="system:serviceaccount:claude-code-demo:maas-client"
oc patch maasauthpolicy claude-code-demo-auth -n models-as-a-service \
  --type=merge -p "{\"spec\":{\"subjects\":{\"users\":[\"${SA_USER}\"]}}}"
oc patch maassubscription claude-code-demo-subscription -n models-as-a-service \
  --type=merge -p "{\"spec\":{\"owner\":{\"users\":[\"${SA_USER}\"]}}}"
```

Verify:

```bash
oc get maasmodelrefs -n claude-code-demo
oc get maasauthpolicies -n models-as-a-service
oc get maassubscriptions -n models-as-a-service
```

## Step 11: Create External Route and API Keys

### Create the external route

The MaaS gateway needs an external Route for API key creation and external access:

```bash
CLUSTER_DOMAIN=$(oc get ingresses.config.openshift.io cluster -o jsonpath='{.spec.domain}')
sed "s/REPLACE_WITH_CLUSTER_DOMAIN/${CLUSTER_DOMAIN}/" maas-api-external-route.yaml | oc apply -f -
```

### Create API keys

#### On ROSA / standard OCP

```bash
MAAS_API="https://maas.${CLUSTER_DOMAIN}"

API_KEY=$(curl -sS \
  -H "Authorization: Bearer $(oc whoami -t)" \
  -H "Content-Type: application/json" \
  -X POST \
  -d '{"name": "litellm-gateway"}' \
  "${MAAS_API}/v1/api-keys" | jq -r .key)

echo "Your MaaS API key: $API_KEY"
echo "Save this - it is only shown once."
```

#### On ARO HCP

ARO HCP uses client certificate auth — `oc whoami -t` returns no token. Create a ServiceAccount token instead:

```bash
MAAS_API="https://maas.${CLUSTER_DOMAIN}"
SA_TOKEN=$(oc create token maas-client -n claude-code-demo --duration=8760h)

API_KEY=$(curl -sS \
  -H "Authorization: Bearer ${SA_TOKEN}" \
  -H "Content-Type: application/json" \
  -X POST \
  -d '{"name": "litellm-gateway"}' \
  "${MAAS_API}/v1/api-keys" | jq -r .key)

echo "Your MaaS API key: $API_KEY"
echo "Save this - it is only shown once."
```

### Store the key in the LiteLLM Secret

```bash
oc patch secret litellm-api-key -n claude-code-demo \
  --type=merge -p "{\"stringData\":{\"maas-api-key\":\"${API_KEY}\"}}"

# Restart LiteLLM to pick up the new secret value
oc rollout restart deployment/litellm-gateway -n claude-code-demo
```

### Connecting Cursor (direct)

```bash
echo "Cursor Base URL: https://maas.${CLUSTER_DOMAIN}/claude-code-demo/qwen3-8-27b/v1"
echo "Cursor API Key: ${API_KEY}"
echo "Cursor Model: qwen3-8-27b"
```

### Connecting Claude Code (via LiteLLM)

Claude Code requires the Anthropic Messages API. LiteLLM translates and routes through MaaS for auth and quota tracking:

```bash
export ANTHROPIC_BASE_URL="https://$(oc get route litellm-gateway -n claude-code-demo -o jsonpath='{.spec.host}')"
export ANTHROPIC_API_KEY="$LITELLM_KEY"
claude
```

## Troubleshooting

### llmisvc-controller-manager not detecting RHCL CRDs

**Symptom**: LLMInferenceService stays in a degraded state with `AuthPolicy CRD not available` even though RHCL is installed and the AuthPolicy CRD exists.

**Cause**: The `llmisvc-controller-manager` caches CRD discovery at startup. If RHCL was installed after the controller started, it won't see the new CRDs.

**Fix**:
```bash
oc rollout restart deployment/llmisvc-controller-manager -n redhat-ods-applications
```

---

### Kuadrant Reconciliation Loop Bug (Fixed in v1.5.3)

**Symptom**: Connections drop every 45-60 seconds with `ServerDisconnectedError` or `TransferEncodingError`. Envoy logs show `filter_chain_is_being_removed`.

**Root Cause**: Non-deterministic `sort.Sort` ordering in Kuadrant caused the EnvoyFilter to be regenerated every second. Fixed upstream in [PR #2184](https://github.com/Kuadrant/kuadrant-operator/pull/2184), shipped in Kuadrant Operator v1.5.3 (03 Sep 2026). RHOAI 3.5 should include the fix.

**If still occurring on RHOAI 3.5**:
```bash
# Verify: EnvoyFilter generation should be static
watch -n 1 "oc get envoyfilter -n openshift-ingress kuadrant-maas-default-gateway -o jsonpath='{.metadata.generation}'"

# Workaround: Scale down Kuadrant operator
oc scale deployment/kuadrant-operator-controller-manager -n openshift-operators --replicas=0
```

**Full details:** See [docs/kuadrant-reconciliation-loop-bug.md](../docs/kuadrant-reconciliation-loop-bug.md)

---

### Streaming Responses Cut Off Mid-Stream

**Symptom**: LiteLLM logs show `TransferEncodingError: Not enough data to satisfy transfer length header` or `ServerDisconnectedError`. Long-running responses (Qwen extended thinking > 5 minutes) fail.

**Cause**: Istio/Envoy gateway has default stream idle timeouts (5 min) and payload processing timeouts (300s).

**Fix**:

1. Apply the stream timeout EnvoyFilter:
```bash
oc apply -f stream-timeout-envoyfilter.yaml
```

2. Patch the payload-processing EnvoyFilter to disable timeouts:
```bash
oc patch envoyfilter -n openshift-ingress payload-processing --type=json -p='[
  {"op": "replace", "path": "/spec/configPatches/0/patch/value/typed_config/message_timeout", "value": "0s"},
  {"op": "replace", "path": "/spec/configPatches/0/patch/value/typed_config/grpc_service/timeout", "value": "0s"},
  {"op": "replace", "path": "/spec/configPatches/1/patch/value/typed_config/message_timeout", "value": "0s"},
  {"op": "replace", "path": "/spec/configPatches/1/patch/value/typed_config/grpc_service/timeout", "value": "0s"}
]'
```

These changes take effect immediately (no pod restart needed). Verify with:
```bash
oc get envoyfilter -n openshift-ingress payload-processing -o json | \
  jq '.spec.configPatches[1].patch.value.typed_config | {message_timeout, grpc_timeout: .grpc_service.timeout}'
```

### Gateway OOMKilled

See the data-science-gateway ConfigMap memory fix in `gateway.yaml` — increases istio-proxy memory to 2Gi.

## File Summary

| File | Purpose |
|------|---------|
| `operator.yaml` | Red Hat Connectivity Link operator subscription |
| `kuadrant.yaml` | Kuadrant CR + namespace |
| `authorino.yaml` | Authorino CR + TLS service |
| `monitoring.yaml` | Enable User Workload Monitoring |
| `postgres.yaml` | PostgreSQL deployment, secrets, PVC, service |
| `gateway.yaml` | MaaS gateway + memory ConfigMap |
| `namespace-label.yaml` | Gateway access label for redhat-ods-applications + claude-code-demo |
| `datasciencecluster-maas.yaml` | Instructions for patching DSC to enable MaaS |
| `maas-api-external-route.yaml` | External Route for MaaS gateway (templated hostname) |
| `../models/granite-llm-inference-service.yaml` | LLMInferenceService for Granite |
| `../models/qwen3-8-llm-inference-service.yaml` | LLMInferenceService for Qwen |
| `model-refs.yaml` | MaaSModelRef registrations |
| `auth-policy.yaml` | MaaSAuthPolicy granting group/user access |
| `subscription.yaml` | MaaSSubscription with token limits |

## References

- [RHOAI 3.5 MaaS Documentation](https://docs.redhat.com/en/documentation/red_hat_openshift_ai_self-managed/3.5/html/govern_llm_access_with_models-as-a-service/)
- [Community Deployment Guide](https://github.com/rh-aiservices-bu/rhoai-maas-guide)
- [Upstream MaaS Repository](https://github.com/opendatahub-io/models-as-a-service)
