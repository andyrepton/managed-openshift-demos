# Debugging JSON Parsing Errors

**Error Pattern:**
```
litellm.BadRequestError: Hosted_vllmException - inference error: 
BadRequest - failed to parse request body: unexpected end of JSON input
```

**Misleading Error:** This says "request body" but it's actually a **response truncation** issue.

## Root Cause

Large JSON responses (tool calls + extended thinking) exceed Envoy/Istio body size limits and get cut off mid-stream. The incomplete JSON then fails to parse.

## How to Reproduce

1. **Run a heavy multi-agent workload** with Claude Code connected to Qwen:
   ```bash
   export ANTHROPIC_BASE_URL="https://$(oc get route litellm-gateway -n claude-code-demo -o jsonpath='{.spec.host}')"
   export ANTHROPIC_API_KEY="$(oc get secret litellm-api-key -n claude-code-demo -o jsonpath='{.data.master-key}' | base64 -d)"
   claude
   ```

2. **Create a long TODO list scenario:**
   - Task with 15+ sub-tasks
   - Use `/workflow` or spawn multiple agents
   - Long-running analysis that generates lots of tool calls

3. **Watch for the error** around 15-20 minutes into the run

## Monitoring During Reproduction

### Terminal 1: Watch MaaS Gateway Logs
```bash
oc logs -f -n openshift-ingress \
  -l gateway.networking.k8s.io/gateway-name=maas-default-gateway \
  --tail=100 | grep -E "413|error|reset|disconnect"
```

**Look for:**
- `413 Request Entity Too Large` - Direct evidence of body size limit
- `downstream_remote_disconnect` - Response cut off
- `stream timeout` - Should NOT see this (we fixed timeouts already)

### Terminal 2: Watch vLLM KV Cache Usage
```bash
oc logs -f -n claude-code-demo \
  $(oc get pods -n claude-code-demo -l serving.kserve.io/inferenceservice=qwen3-6-27b -o name | head -1) \
  | grep "KV cache usage"
```

**Look for:**
- KV cache usage approaching 100% (indicates memory pressure)
- Example output: `GPU KV cache usage: 94.2%`
- If consistently >90%, the model might be aborting responses

### Terminal 3: Watch LiteLLM Gateway
```bash
oc logs -f -n claude-code-demo -l app=litellm-gateway \
  | grep -E "ERROR|BadRequest|JSON|incomplete"
```

**Look for:**
- The actual `BadRequestError` when it occurs
- Any preceding warnings about response size
- Connection reset messages

### Terminal 4: Monitor Response Sizes
```bash
# Watch Envoy access logs for large responses
oc logs -f -n openshift-ingress \
  -l gateway.networking.k8s.io/gateway-name=maas-default-gateway \
  | awk '{print $10, $11}' | grep -v " 0 "
```

**Columns:**
- Column 10: Bytes sent to downstream (response size)
- Column 11: Bytes received from upstream (request size)

**Look for:**
- Response sizes approaching 1-4MB (1048576 - 4194304 bytes)
- Sudden drops to 0 (truncation)

## Expected vs Actual Behavior

### Before Fix

**Expected (no body size limit):**
```
[timestamp] "POST /v1/chat/completions HTTP/1.1" 200 - 
  request_bytes response_bytes time_ms
```

**Actual (hitting limit):**
```
[timestamp] "POST /v1/chat/completions HTTP/1.1" 413 DC 
  request_bytes 0 time_ms
```
OR
```
[timestamp] "POST /v1/chat/completions HTTP/1.1" 200 DC 
  request_bytes partial_bytes time_ms
```
(200 but with DC = downstream disconnect = truncated)

### After Fix (envoy-body-size-fix.yaml applied)

**Expected:**
```
[timestamp] "POST /v1/chat/completions HTTP/1.1" 200 - 
  1234 52428800 60000
```
- Status: 200 (success)
- No DC flag (complete response)
- Large response size (up to 50MB supported)
- Time might be long (60s+) for complex responses

## Verification Commands

### Check if the fix is applied
```bash
oc get envoyfilter -n openshift-ingress maas-increase-body-size
```

Should show:
```
NAME                       AGE
maas-increase-body-size    5m
```

### Verify Envoy picked up the config
```bash
oc exec -n openshift-ingress \
  $(oc get pods -n openshift-ingress -l gateway.networking.k8s.io/gateway-name=maas-default-gateway -o name) \
  -- curl -s localhost:15000/config_dump | jq '.configs[] | select(.["@type"] == "type.googleapis.com/envoy.admin.v3.ListenersConfigDump") | .dynamic_listeners[].active_state.listener.filter_chains[].filters[] | select(.name == "envoy.filters.network.http_connection_manager") | .typed_config.max_request_headers_kb'
```

Should show: `96` (up from default 60)

### Check current EnvoyFilter priority
```bash
oc get envoyfilter -n openshift-ingress -o json | \
  jq -r '.items[] | "\(.metadata.name): priority=\(.spec.priority // "default")"'
```

Should show:
```
maas-increase-body-size: priority=20
payload-processing: priority=10
```

## Test Scenario

### Reproduce the Issue

1. **Create a file with a large TODO list:**
```python
# /tmp/large-test.py
"""
TODO:
1. Analyze this function and suggest improvements
2. Write comprehensive unit tests
3. Add error handling for edge cases
4. Document all parameters
5. Add type hints
6. Optimize for performance
7. Check for security vulnerabilities
8. Add logging
9. Refactor for readability
10. Add integration tests
11. Check compatibility with Python 3.9+
12. Add docstrings
13. Create usage examples
14. Add CI/CD pipeline
15. Review and suggest architectural changes
16. Add monitoring
17. Add metrics
18. Create API documentation
19. Add rate limiting
20. Performance profiling
"""

def complex_function(data):
    # Deliberately complex code here
    result = []
    for item in data:
        if isinstance(item, dict):
            for key, value in item.items():
                if isinstance(value, list):
                    result.extend([x for x in value if x > 0])
                elif isinstance(value, dict):
                    result.append(sum(value.values()))
        elif isinstance(item, list):
            result.append(len(item))
    return result
```

2. **Run Claude Code and execute:**
```
Read /tmp/large-test.py and work through all the TODOs using sub-agents.
```

3. **Monitor all 4 terminals** (gateway, vLLM, LiteLLM, response sizes)

4. **Watch for the error** around TODO item 10-15

### Expected Results

**Before fix:**
- Error appears: `BadRequest - failed to parse request body: unexpected end of JSON input`
- Gateway logs show: `413` or `200 DC` (disconnect)
- Response size truncated at ~1-4MB

**After fix:**
- Task completes successfully
- No JSON parsing errors
- Response sizes can go up to 50MB
- Gateway logs show: `200` with no DC flag

## Measuring Success

✅ **Fix is successful when:**
1. The same test scenario completes without JSON parsing errors
2. No 413 errors in gateway logs
3. No premature disconnects (DC flags)
4. Response sizes can exceed 4MB without truncation
5. User no longer needs to "prompt for continuation"

## Alternative Diagnostics

### If the error persists after applying the fix:

1. **Check vLLM output token limit:**
```bash
oc logs -n claude-code-demo qwen3-6-27b-xxx | grep "max.*tokens"
```

Look for messages about hitting output token limits.

2. **Check KV cache exhaustion:**
```bash
oc logs -n claude-code-demo qwen3-6-27b-xxx | tail -100 | grep "OOM\|cache"
```

If KV cache is hitting 100%, add to vLLM args:
```yaml
- --gpu-memory-utilization=0.95  # Up from 0.90
```

3. **Check HAProxy/Route timeout:**
```bash
oc get route litellm-gateway -n claude-code-demo \
  -o jsonpath='{.metadata.annotations.haproxy\.router\.openshift\.io/timeout}'
```

Should show: `10m` (we already set this)

4. **Check for memory pressure:**
```bash
oc top pod -n claude-code-demo -l app=litellm-gateway
oc top pod -n claude-code-demo -l serving.kserve.io/inferenceservice=qwen3-6-27b
```

If LiteLLM is near 2Gi limit, increase it further.

## Logs to Collect for Bug Report

If the issue persists, collect:

```bash
# 1. Gateway access logs during failure
oc logs -n openshift-ingress \
  $(oc get pods -n openshift-ingress -l gateway.networking.k8s.io/gateway-name=maas-default-gateway -o name) \
  --since=10m > gateway-logs.txt

# 2. LiteLLM logs
oc logs -n claude-code-demo -l app=litellm-gateway --since=10m > litellm-logs.txt

# 3. vLLM logs
oc logs -n claude-code-demo \
  $(oc get pods -n claude-code-demo -l serving.kserve.io/inferenceservice=qwen3-6-27b -o name) \
  --since=10m > vllm-logs.txt

# 4. EnvoyFilter configs
oc get envoyfilter -n openshift-ingress -o yaml > envoyfilters.yaml

# 5. Gateway config
oc get gateway -n openshift-ingress maas-default-gateway -o yaml > gateway.yaml
```

Then share these files with the analysis in `docs/user-feedback-analysis.md`.

## References

- [Envoy Buffer Filter](https://www.envoyproxy.io/docs/envoy/latest/configuration/http/http_filters/buffer_filter)
- [HTTP Connection Manager](https://www.envoyproxy.io/docs/envoy/latest/api-v3/extensions/filters/network/http_connection_manager/v3/http_connection_manager.proto)
- [Istio EnvoyFilter](https://istio.io/latest/docs/reference/config/networking/envoy-filter/)
