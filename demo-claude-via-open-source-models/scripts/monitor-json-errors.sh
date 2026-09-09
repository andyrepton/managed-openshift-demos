#!/bin/bash
#
# Monitor for JSON parsing errors and response truncation
#
# Usage: ./scripts/monitor-json-errors.sh
#
# Runs 4 monitoring sessions in the background:
# 1. MaaS Gateway logs (413 errors, disconnects)
# 2. vLLM KV cache usage
# 3. LiteLLM errors
# 4. Response sizes

set -e

echo "========================================="
echo "JSON Parsing Error Monitoring"
echo "========================================="
echo ""
echo "Press Ctrl+C to stop all monitors"
echo ""

# Create temp directory for logs
LOGDIR="/tmp/maas-monitor-$(date +%s)"
mkdir -p "$LOGDIR"
echo "Logs will be saved to: $LOGDIR"
echo ""

# Get pod names
GATEWAY_POD=$(oc get pods -n openshift-ingress -l gateway.networking.k8s.io/gateway-name=maas-default-gateway -o name | head -1)
QWEN_POD=$(oc get pods -n claude-code-demo -l serving.kserve.io/inferenceservice=qwen3-6-27b -o name | head -1)
LITELLM_POD=$(oc get pods -n claude-code-demo -l app=litellm-gateway -o name | head -1)

if [ -z "$GATEWAY_POD" ] || [ -z "$QWEN_POD" ] || [ -z "$LITELLM_POD" ]; then
    echo "ERROR: Could not find all required pods"
    echo "Gateway: $GATEWAY_POD"
    echo "Qwen: $QWEN_POD"
    echo "LiteLLM: $LITELLM_POD"
    exit 1
fi

echo "Monitoring pods:"
echo "  Gateway: $GATEWAY_POD"
echo "  Qwen:    $QWEN_POD"
echo "  LiteLLM: $LITELLM_POD"
echo ""

# Cleanup function
cleanup() {
    echo ""
    echo "========================================="
    echo "Stopping monitors..."
    echo "========================================="
    jobs -p | xargs -r kill 2>/dev/null || true
    echo ""
    echo "Logs saved to: $LOGDIR"
    echo "  gateway.log    - MaaS gateway access logs"
    echo "  kvcache.log    - vLLM KV cache usage"
    echo "  litellm.log    - LiteLLM errors"
    echo "  responses.log  - Response sizes"
    echo ""
    echo "To analyze:"
    echo "  grep '413\\|DC' $LOGDIR/gateway.log"
    echo "  grep 'BadRequest\\|JSON' $LOGDIR/litellm.log"
    echo "  awk '\$1 > 4194304' $LOGDIR/responses.log  # Responses >4MB"
}

trap cleanup EXIT INT TERM

# Monitor 1: Gateway logs for 413 errors and disconnects
echo "Starting Monitor 1: Gateway logs (413, errors, disconnects)"
(
    oc logs -f -n openshift-ingress "$GATEWAY_POD" --tail=0 2>&1 | \
    grep --line-buffered -E "413|error|reset|disconnect|DC" | \
    tee "$LOGDIR/gateway.log" | \
    while IFS= read -r line; do
        echo "[GATEWAY] $line"
    done
) &

# Monitor 2: vLLM KV cache usage
echo "Starting Monitor 2: vLLM KV cache usage"
(
    oc logs -f -n claude-code-demo "$QWEN_POD" --tail=0 2>&1 | \
    grep --line-buffered "KV cache usage" | \
    tee "$LOGDIR/kvcache.log" | \
    while IFS= read -r line; do
        # Extract percentage
        if [[ $line =~ KV\ cache\ usage:\ ([0-9.]+)% ]]; then
            pct="${BASH_REMATCH[1]}"
            if (( $(echo "$pct > 90" | bc -l) )); then
                echo "[KV CACHE] ⚠️  HIGH: $line"
            else
                echo "[KV CACHE] $line"
            fi
        fi
    done
) &

# Monitor 3: LiteLLM errors
echo "Starting Monitor 3: LiteLLM errors"
(
    oc logs -f -n claude-code-demo "$LITELLM_POD" --tail=0 2>&1 | \
    grep --line-buffered -E "ERROR|BadRequest|JSON|incomplete" | \
    tee "$LOGDIR/litellm.log" | \
    while IFS= read -r line; do
        if [[ $line =~ "BadRequest" ]] || [[ $line =~ "JSON" ]]; then
            echo "[LITELLM] 🔴 $line"
        else
            echo "[LITELLM] $line"
        fi
    done
) &

# Monitor 4: Response sizes
echo "Starting Monitor 4: Response sizes"
(
    oc logs -f -n openshift-ingress "$GATEWAY_POD" --tail=0 2>&1 | \
    awk '{print $10, $11, $12, $1}' | \
    grep -v " 0 " | \
    tee "$LOGDIR/responses.log" | \
    while read -r bytes_sent bytes_received duration timestamp; do
        # Check if response is large (>1MB)
        if [[ "$bytes_sent" =~ ^[0-9]+$ ]] && [ "$bytes_sent" -gt 1048576 ]; then
            mb=$(echo "scale=2; $bytes_sent / 1048576" | bc)
            if [ "$bytes_sent" -gt 4194304 ]; then
                echo "[RESPONSE] ✅ LARGE (${mb}MB) - Fix is working! [$timestamp]"
            else
                echo "[RESPONSE] ${mb}MB [$timestamp]"
            fi
        fi
    done
) &

echo ""
echo "========================================="
echo "All monitors started!"
echo "========================================="
echo ""
echo "What to watch for:"
echo "  🔴 [LITELLM] BadRequest/JSON errors"
echo "  ⚠️  [KV CACHE] Usage >90%"
echo "  ❌ [GATEWAY] 413 or DC flags"
echo "  ✅ [RESPONSE] Large responses >4MB (means fix is working)"
echo ""
echo "Now run your multi-agent test in Claude Code..."
echo ""

# Wait for all background jobs
wait
