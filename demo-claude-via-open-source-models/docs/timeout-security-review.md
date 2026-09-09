# Timeout Configuration Security Review

## Current State (Development/Debug Settings)

We currently have **infinite timeouts** (0s) in multiple places. This was done to debug connection issues, but **infinite timeouts are not production-safe**.

### Current Infinite Timeouts

| Component | Setting | File | Risk Level |
|-----------|---------|------|------------|
| Stream idle timeout | `0s` (infinite) | `maas/stream-timeout-envoyfilter.yaml` | 🔴 HIGH |
| Request timeout | `0s` (infinite) | `maas/stream-timeout-envoyfilter.yaml` | 🔴 HIGH |
| Connection idle timeout | `0s` (infinite) | `maas/stream-timeout-envoyfilter.yaml` | 🔴 HIGH |
| Max stream duration | `0s` (infinite) | `maas/stream-timeout-envoyfilter.yaml` | 🔴 HIGH |
| Payload processing timeout | `0s` (infinite) | Patched `payload-processing` EnvoyFilter | 🔴 HIGH |
| Payload processing gRPC timeout | `0s` (infinite) | Patched `payload-processing` EnvoyFilter | 🔴 HIGH |
| aiohttp total timeout | `0` (infinite) | `litellm-gateway/litellm-deployment.yaml` | 🟡 MEDIUM |
| aiohttp sock read timeout | `0` (infinite) | `litellm-gateway/litellm-deployment.yaml` | 🟡 MEDIUM |
| aiohttp keepalive timeout | `0` (infinite) | `litellm-gateway/litellm-deployment.yaml` | 🟡 MEDIUM |

### Reasonable Timeouts (OK for Production)

| Component | Setting | File | Risk Level |
|-----------|---------|------|------------|
| Route timeout | `10m` (600s) | `litellm-gateway/litellm-route.yaml` | ✅ OK |
| LiteLLM request timeout | `600s` (10m) | `litellm-gateway/litellm-deployment.yaml` | ✅ OK |
| aiohttp connect timeout | `60s` | `litellm-gateway/litellm-deployment.yaml` | ✅ OK |

## Security Risks of Infinite Timeouts

### 1. Slowloris Attacks
**Attack:** Client opens connection and sends data very slowly (1 byte per minute)  
**Impact:** With infinite timeouts, connection stays open forever  
**Resource exhaustion:** Attacker opens 10,000 connections → server runs out of resources  

### 2. Memory Leaks
**Problem:** Long-running connections accumulate state in memory  
**Impact:** Without timeout cleanup, memory usage grows unbounded  
**Manifestation:** OOM kills after hours/days of operation  

### 3. Zombie Connections
**Problem:** Client crashes without closing connection properly  
**Impact:** Connection stays open forever consuming resources  
**Scale:** In production, this happens frequently (network issues, client crashes, etc.)  

### 4. No Backpressure
**Problem:** Clients can send unlimited data with no time limit  
**Impact:** CPU/memory exhaustion from processing oversized requests  
**Example:** Malicious client sends 1GB prompt over 30 minutes  

### 5. Harder Debugging
**Problem:** Hung connections don't produce timeout errors  
**Impact:** Issues are silent until resource exhaustion  
**Developer experience:** "Why is the pod crashing?" vs "Request timed out after 10m"  

## Production-Safe Timeout Recommendations

### For LLM Inference Workloads

Based on actual usage patterns:
- **Longest legitimate response:** Qwen extended thinking = ~2-3 minutes
- **Longest multi-agent run:** ~15-20 minutes (reported by tvaughan)
- **Safety margin:** 2x longest expected time

### Recommended Values

```yaml
# Envoy/Istio (maas/stream-timeout-envoyfilter.yaml)
stream_idle_timeout: 300s        # 5 minutes (was: 0s)
request_timeout: 900s             # 15 minutes (was: 0s)
idle_timeout: 1800s               # 30 minutes (was: 0s)
max_stream_duration: 1800s        # 30 minutes (was: 0s)

# Payload Processing (patched EnvoyFilter)
message_timeout: 900s             # 15 minutes (was: 0s)
grpc_service.timeout: 900s        # 15 minutes (was: 0s)

# LiteLLM (litellm-gateway/litellm-deployment.yaml)
LITELLM_REQUEST_TIMEOUT: 900      # 15 minutes (currently: 600s - increase)
AIOHTTP_TOTAL_TIMEOUT: 900        # 15 minutes (was: 0)
AIOHTTP_SOCK_READ_TIMEOUT: 900    # 15 minutes (was: 0)
AIOHTTP_KEEPALIVE_TIMEOUT: 1800   # 30 minutes (was: 0)

# Route (already correct)
haproxy.router.openshift.io/timeout: 15m  # Was: 10m, increase to 15m
```

### Why These Values?

| Timeout | Value | Rationale |
|---------|-------|-----------|
| Stream idle | 5min | If no data for 5 minutes, connection is likely hung |
| Request total | 15min | 2x longest observed multi-agent run |
| Connection idle | 30min | Allow connection reuse, but cleanup eventually |
| Max stream | 30min | Hard cap to prevent runaway processes |

### Special Cases

**If you see legitimate workloads >15 minutes:**
- Increase to 30 minutes
- Or redesign to use chunked processing with checkpoints
- Or use async patterns with polling instead of streaming

**For development/testing:**
- Keep current infinite timeouts
- Add a comment: `# WARNING: DEV ONLY - Set to finite value for production`

## Testing Timeout Changes

### Scenario 1: Quick Request (Should Always Work)
```bash
# Simple prompt, ~5 second response
curl -X POST "$GATEWAY_URL/v1/messages" \
  -H "x-api-key: $KEY" -H "anthropic-version: 2023-06-01" \
  -d '{"model": "granite-4-1-30b", "max_tokens": 100, "messages": [{"role": "user", "content": "Hello"}]}'
```
**Expected:** Success with any timeout >5s

### Scenario 2: Medium Request (Qwen Extended Thinking)
```bash
# Complex analysis, ~2-3 minute response
curl -X POST "$GATEWAY_URL/v1/messages" \
  -H "x-api-key: $KEY" -H "anthropic-version: 2023-06-01" \
  -d '{"model": "qwen3-6-27b", "max_tokens": 2048, "messages": [{"role": "user", "content": "Analyze the architectural trade-offs..."}]}'
```
**Expected:** Success with timeout >180s (3 min)

### Scenario 3: Multi-Agent Run (Longest)
```bash
# 20-item TODO list with sub-agents
# Run via Claude Code (see docs/reproduce-test-scenario.md)
```
**Expected:** Success with timeout >900s (15 min)

### Scenario 4: Timeout Validation (Should Fail)
```bash
# Deliberately slow response
# Set timeout to 10s, run scenario 2 above
```
**Expected:** Timeout error after 10s (proves timeout is enforced)

## Rollback Plan

If production-safe timeouts cause issues:

1. **Identify which timeout is too short:**
```bash
# Check logs for timeout errors
oc logs -n openshift-ingress gateway-xxx | grep timeout
oc logs -n claude-code-demo litellm-xxx | grep timeout
```

2. **Increase incrementally:**
```
15min → 20min → 25min → 30min
```

3. **Ultimate fallback:**
```bash
# Restore infinite timeouts (DEV ONLY)
oc apply -f maas/stream-timeout-envoyfilter.yaml  # With 0s values
```

## Recommendation

### For Current Demo/Testing
**Keep infinite timeouts** - They're working and the user workload is succeeding.

### For Production Deployment
**Switch to finite timeouts** using values above:
- 5 min stream idle
- 15 min request timeout
- 30 min connection idle

### Monitoring to Add
```yaml
# Alert on timeouts
- alert: HighTimeoutRate
  expr: rate(envoy_http_downstream_rq_timeout[5m]) > 0.01
  annotations:
    summary: "Requests timing out - may need to increase timeout values"
```

## Action Items

**Immediate (for this repo):**
- [ ] Document current infinite timeouts as "DEV/TESTING ONLY"
- [ ] Add production-safe timeout values in comments
- [ ] Create `maas/stream-timeout-envoyfilter-production.yaml` with finite values

**Before Production:**
- [ ] Replace infinite timeouts with recommended values
- [ ] Test with longest expected workload
- [ ] Add timeout monitoring/alerting
- [ ] Document timeout tuning process

## Conclusion

**Were timeouts red herrings?** YES, mostly.
- Kuadrant bug was the real issue for disconnects (fixed by scaling operator)
- Body size was the real issue for JSON parsing (fixed by body size increase)
- Infinite timeouts may have masked actual issues

**Should we change them?** DEPENDS.
- **For demo/testing:** Keep infinite timeouts (easier debugging)
- **For production:** Use finite timeouts (security + proper error handling)

**Risk of keeping infinite timeouts:**
- Low risk for single-user demo environment
- High risk for production multi-tenant environment
- Medium risk: Memory/resource leaks over time

**Recommended compromise:**
- Keep infinite timeouts NOW (working environment)
- Add comments warning they're dev-only
- Provide production-safe alternatives in separate files
- Test production values before deploying to real users
