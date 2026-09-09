#!/bin/bash
#
# Test script for LiteLLM gateway and models
#
# Usage:
#   ./scripts/test-models.sh [model-name]
#
# If no model name is provided, tests all configured models

set -e

# Get gateway URL and API key from cluster
GATEWAY_URL=$(oc get route litellm-gateway -n claude-code-demo -o jsonpath='{.spec.host}' 2>/dev/null)
LITELLM_KEY=$(oc get secret litellm-api-key -n claude-code-demo -o jsonpath='{.data.master-key}' 2>/dev/null | base64 -d)

if [ -z "$GATEWAY_URL" ] || [ -z "$LITELLM_KEY" ]; then
    echo "Error: Could not retrieve gateway URL or API key"
    echo "Make sure you're logged into the cluster and the gateway is deployed"
    exit 1
fi

echo "Gateway URL: https://$GATEWAY_URL"
echo "Testing models..."
echo

# Test function
test_model() {
    local model_name=$1
    local test_prompt=${2:-"Write a Python hello world program"}

    echo "Testing model: $model_name"
    echo "Prompt: $test_prompt"
    echo "---"

    response=$(curl -s -X POST "https://$GATEWAY_URL/v1/messages" \
      -H "x-api-key: $LITELLM_KEY" \
      -H "anthropic-version: 2023-06-01" \
      -H "Content-Type: application/json" \
      -d "{
        \"model\": \"$model_name\",
        \"max_tokens\": 256,
        \"messages\": [{\"role\": \"user\", \"content\": \"$test_prompt\"}]
      }")

    # Check if response is an error
    if echo "$response" | jq -e '.error' > /dev/null 2>&1; then
        echo "ERROR: $(echo "$response" | jq -r '.error.message')"
        return 1
    fi

    # Extract and display response
    echo "$response" | jq -r '.content[].text // .content[].thinking // empty' 2>/dev/null || echo "Could not parse response"

    # Show token usage
    echo
    echo "Token usage:"
    echo "$response" | jq '.usage' 2>/dev/null || echo "No usage data"
    echo
}

# Warm-up function (first request is always slow)
warmup_model() {
    local model_name=$1
    echo "Warming up $model_name (first request compiles CUDA graphs)..."
    curl -s -X POST "https://$GATEWAY_URL/v1/messages" \
      -H "x-api-key: $LITELLM_KEY" \
      -H "anthropic-version: 2023-06-01" \
      -H "Content-Type: application/json" \
      -d "{
        \"model\": \"$model_name\",
        \"max_tokens\": 16,
        \"messages\": [{\"role\": \"user\", \"content\": \"Hi\"}]
      }" > /dev/null 2>&1 || true
    echo "Warm-up complete"
    echo
}

# If model name provided, test only that model
if [ $# -gt 0 ]; then
    model=$1
    warmup_model "$model"
    test_model "$model" "${2:-Write a Python hello world program}"
    exit 0
fi

# Otherwise test all models
echo "=== Testing Granite (claude-sonnet-5) ==="
warmup_model "claude-sonnet-5"
test_model "claude-sonnet-5" "Write a Python function to reverse a string"

echo
echo "=== Testing Qwen (claude-opus-5) ==="
warmup_model "claude-opus-5"
test_model "claude-opus-5" "Write a Python function to check if a number is prime"

echo
echo "=== Testing Direct Model Names ==="
test_model "granite-4-1-30b" "Explain what a decorator is in Python"
echo
test_model "qwen3-6-27b" "Write unit tests for a function that adds two numbers"

echo
echo "All tests complete!"
