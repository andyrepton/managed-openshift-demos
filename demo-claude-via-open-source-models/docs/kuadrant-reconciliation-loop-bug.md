# Kuadrant EnvoyFilter Reconciliation Loop Bug

**Affected Versions:** RHOAI 3.4.4 with Kuadrant/RHCL 1.4  
**Severity:** High - Causes connection drops every 45-60 seconds during long-running requests  
**Status:** Known bug, workaround available

## Problem

The Kuadrant operator enters a continuous reconciliation loop, updating the `kuadrant-maas-default-gateway` EnvoyFilter **every second**. Each update triggers an Envoy hot restart which drops active connections with `filter_chain_is_being_removed`.

## Symptoms

- LiteLLM logs show `ServerDisconnectedError` or `TransferEncodingError` after 30-60 seconds
- Envoy access logs show `downstream_local_disconnect(filter_chain_is_being_removed)`
- EnvoyFilter `metadata.generation` increases by 6-7 per minute (should be static)
- Kuadrant operator logs show continuous "build Wasm configuration" cycles
- Long-running streaming responses (Qwen extended thinking) are killed mid-stream

## Evidence

```bash
# Check EnvoyFilter generation (should be static, but increases continuously)
oc get envoyfilter -n openshift-ingress kuadrant-maas-default-gateway -o jsonpath='{.metadata.generation}'

# Watch it increase every second
watch -n 1 "oc get envoyfilter -n openshift-ingress kuadrant-maas-default-gateway -o jsonpath='{.metadata.generation}'"

# Check Kuadrant operator reconciliation loop
oc logs -n openshift-operators deployment/kuadrant-operator-controller-manager --tail=50 | grep "build Wasm"
```

## Root Cause

The Kuadrant operator continuously rebuilds the WASM plugin configuration, likely due to:

1. A feedback loop between AuthPolicy/TokenRateLimitPolicy updates
2. A bug in RHCL 1.4 WASM plugin hash calculation
3. Istio/Envoy version incompatibility with Kuadrant

Each EnvoyFilter update triggers an Envoy hot restart which:
1. Removes old filter chains (`filter_chain_is_being_removed`)
2. Kills active HTTP connections mid-stream
3. Causes the 45-second timeout pattern (time between updates)

## Temporary Workaround (Testing Only)

Scale down the Kuadrant operator to freeze the EnvoyFilter:

```bash
oc scale deployment/kuadrant-operator-controller-manager -n openshift-operators --replicas=0
```

**Verify it worked:**
```bash
# EnvoyFilter generation should stay constant
oc get envoyfilter -n openshift-ingress kuadrant-maas-default-gateway -o jsonpath='{.metadata.generation}'
sleep 10
oc get envoyfilter -n openshift-ingress kuadrant-maas-default-gateway -o jsonpath='{.metadata.generation}'
# Both outputs should be identical
```

**WARNING:** This disables dynamic AuthPolicy and RateLimitPolicy updates. If you change MaaS policies, you must:
1. Scale Kuadrant back up (`--replicas=1`)
2. Wait for policies to reconcile
3. Scale back down immediately

## Permanent Fix Options

### Option 1: Bypass MaaS Gateway (Recommended for Production)

Connect LiteLLM directly to vLLM KServe endpoints, bypassing the MaaS gateway entirely:

```yaml
# litellm-gateway/litellm-config.yaml
model_list:
  - model_name: "claude-sonnet-5"
    litellm_params:
      model: hosted_vllm/granite-4-1-30b
      api_base: http://granite-4-1-30b-kserve-workload-svc.claude-code-demo.svc.cluster.local:8000/v1
      # No MaaS gateway, no Kuadrant, no disconnects
```

**Trade-offs:**
- ✅ No connection drops
- ✅ Lower latency (one less hop)
- ❌ No MaaS usage tracking
- ❌ No per-user token quotas
- ❌ No API key authentication (use LiteLLM keys instead)

### Option 2: Report to Red Hat

This is a Kuadrant/RHCL bug. Open a case with Red Hat OpenShift AI support:

**Issue Summary:**
> Kuadrant operator enters infinite reconciliation loop updating EnvoyFilter every second, causing Envoy hot restarts that drop active connections with `filter_chain_is_being_removed`. This breaks long-running streaming responses in Models-as-a-Service.

**Reproducer:**
1. Deploy RHOAI 3.4.4 with MaaS enabled
2. Create LLMInferenceService with TokenRateLimitPolicy
3. Send long-running streaming request (>60 seconds)
4. Observe EnvoyFilter generation increasing continuously
5. Connection drops mid-stream with `filter_chain_is_being_removed`

**Expected:** EnvoyFilter should only update when policies change  
**Actual:** EnvoyFilter updates every second regardless of policy changes

### Option 3: Wait for RHOAI 3.5+

Kuadrant and RHCL are under active development. Future releases may fix this issue.

## Applied Workarounds in This Demo

This demo applies **all** of the following fixes:

1. **Scaled down Kuadrant operator** (temporary, testing only)
2. **TCP keepalive on MaaS gateway LoadBalancer** (AWS ELB idle timeout: 600s)
3. **LiteLLM aiohttp timeout configuration** (disabled socket read timeout)
4. **Envoy stream timeout configuration** (disabled all Envoy timeouts)
5. **Payload processing timeout** (increased from 300s → infinite)

Even with all these fixes, the Kuadrant reconciliation loop still causes disconnects. **Scaling down the operator is the only reliable workaround.**

## Testing the Fix

After applying the workaround:

```bash
# Test long-running request
export ANTHROPIC_BASE_URL="https://$(oc get route litellm-gateway -n claude-code-demo -o jsonpath='{.spec.host}')"
export ANTHROPIC_API_KEY="$(oc get secret litellm-api-key -n claude-code-demo -o jsonpath='{.data.master-key}' | base64 -d)"

# Send a request that takes >2 minutes
curl -X POST "$ANTHROPIC_BASE_URL/v1/messages" \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-opus-5",
    "max_tokens": 2048,
    "messages": [{
      "role": "user",
      "content": "Write a comprehensive analysis of sorting algorithms with detailed pseudocode and complexity proofs."
    }]
  }'
```

Should complete without `ServerDisconnectedError`.

## Re-enabling Kuadrant (When Needed)

To enable policy updates:

```bash
# Scale up temporarily
oc scale deployment/kuadrant-operator-controller-manager -n openshift-operators --replicas=1

# Wait 30 seconds for policies to reconcile
sleep 30

# Scale back down immediately
oc scale deployment/kuadrant-operator-controller-manager -n openshift-operators --replicas=0
```

## References

- [Kuadrant Operator GitHub](https://github.com/Kuadrant/kuadrant-operator)
- [RHCL Documentation](https://docs.redhat.com/en/documentation/red_hat_connectivity_link/)
- [Envoy Hot Restart](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/operations/hot_restart)
- [MaaS Tech Preview Limitations](https://docs.redhat.com/en/documentation/red_hat_openshift_ai_self-managed/3.4/html/govern_llm_access_with_models-as-a-service/)

---

**Created:** 2026-09-08  
**Last Updated:** 2026-09-08  
**RHOAI Version:** 3.4.4  
**Kuadrant Version:** Unknown (bundled with RHOAI 3.4.4)
