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

**Important**: MaaS serves OpenAI-compatible endpoints (`/v1/chat/completions`). Claude Code requires the Anthropic Messages API (`/v1/messages`), so LiteLLM is still needed for API translation. Cursor and other OpenAI-compatible tools can connect to MaaS directly.

## Prerequisites

- RHOAI 3.5+ installed
- OpenShift 4.19+
- cert-manager operator installed (from base demo)
- Models downloaded to PVCs (from base demo)
- cluster-admin access

## Step 1: Enable User Workload Monitoring

MaaS uses Prometheus for usage tracking. Enable user workload monitoring if not already enabled:

```bash
oc apply -f monitoring.yaml
```

## Step 2: Install Red Hat Connectivity Link

```bash
oc apply -f operator.yaml

# Wait for the operator CSV to succeed
oc get csv -n openshift-operators | grep rhcl
# Should show "Succeeded"
```

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

## Step 6: Label Namespace and Create Gateway

The MaaS gateway uses namespace selectors — the `redhat-ods-applications` namespace needs the gateway access label:

```bash
oc apply -f namespace-label.yaml
oc apply -f gateway.yaml
oc wait --for=condition=Programmed gateway/maas-default-gateway \
  -n openshift-ingress --timeout=120s
```

## Step 7: Enable MaaS in the DataScienceCluster

This adds `modelsAsService` under the `kserve` component:

```bash
oc apply -f datasciencecluster-maas.yaml

# Wait for maas-api to start
oc get deployment maas-api -n redhat-ods-applications -w
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
oc delete inferenceservice granite-4-1-30b qwen3-6-27b -n claude-code-demo 2>/dev/null

# Deploy as LLMInferenceServices
oc apply -f ../models/granite-llm-inference-service.yaml
oc apply -f ../models/qwen-llm-inference-service.yaml

# Wait for models to load
oc get llminferenceservice -n claude-code-demo -w
```

## Step 10: Register Models and Create Access Policies

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

Verify:

```bash
oc get maasmodelrefs -n claude-code-demo
oc get maasauthpolicies -n models-as-a-service
oc get maassubscriptions -n models-as-a-service
```

## Step 11: Create API Keys and Connect

Get the MaaS API endpoint:

```bash
CLUSTER_DOMAIN=$(oc get ingresses.config.openshift.io cluster -o jsonpath='{.spec.domain}')
MAAS_API="https://maas.${CLUSTER_DOMAIN}/maas-api"
```

Create an API key:

```bash
API_KEY=$(curl -sS \
  -H "Authorization: Bearer $(oc whoami -t)" \
  -H "Content-Type: application/json" \
  -X POST \
  -d '{
    "name": "claude-code-key",
    "description": "API key for Claude Code demo",
    "subscription": "claude-code-demo-subscription"
  }' \
  "${MAAS_API}/v1/api-keys" | jq -r .key)

echo "Your API key: $API_KEY"
echo "Save this - it is only shown once."
```

### Connecting Cursor (direct)

```bash
MODEL_URL=$(curl -sS "${MAAS_API}/v1/models" \
  -H "Authorization: Bearer ${API_KEY}" | jq -r '.data[0].url')

echo "Cursor Base URL: ${MODEL_URL}/v1"
echo "Cursor API Key: ${API_KEY}"
echo "Cursor Model: granite-4-1-30b or qwen3-6-27b"
```

### Connecting Claude Code (via LiteLLM)

Claude Code requires the Anthropic Messages API. Update LiteLLM's config to route through MaaS endpoints for auth and quota tracking, then connect Claude Code to LiteLLM as normal:

```bash
export ANTHROPIC_BASE_URL="https://$(oc get route litellm-gateway -n claude-code-demo -o jsonpath='{.spec.host}')"
export ANTHROPIC_API_KEY="$LITELLM_KEY"
claude
```

## Troubleshooting

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
| `namespace-label.yaml` | Gateway access label for redhat-ods-applications |
| `datasciencecluster-maas.yaml` | DSC with modelsAsService enabled |
| `../models/granite-llm-inference-service.yaml` | LLMInferenceService for Granite |
| `../models/qwen-llm-inference-service.yaml` | LLMInferenceService for Qwen |
| `model-refs.yaml` | MaaSModelRef registrations |
| `auth-policy.yaml` | MaaSAuthPolicy granting group access |
| `subscription.yaml` | MaaSSubscription with token limits |

## References

- [RHOAI 3.5 MaaS Documentation](https://docs.redhat.com/en/documentation/red_hat_openshift_ai_self-managed/3.5/html/govern_llm_access_with_models-as-a-service/)
- [Community Deployment Guide](https://github.com/rh-aiservices-bu/rhoai-maas-guide)
- [Upstream MaaS Repository](https://github.com/opendatahub-io/models-as-a-service)
