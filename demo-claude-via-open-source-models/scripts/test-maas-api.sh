#!/bin/bash
#
# Test script for MaaS API direct access
#
# Usage:
#   ./scripts/test-maas-api.sh [api-key]
#
# If no API key is provided, attempts to use the one from environment

set -e

# Get MaaS API URL
MAAS_URL="https://maas.$(oc get ingresses.config.openshift.io cluster -o jsonpath='{.spec.domain}' 2>/dev/null)"

if [ -z "$MAAS_URL" ]; then
    echo "Error: Could not determine cluster domain"
    exit 1
fi

# Get API key from argument or environment
API_KEY=${1:-${MAAS_API_KEY}}

if [ -z "$API_KEY" ]; then
    echo "Error: No API key provided"
    echo
    echo "Usage: $0 <api-key>"
    echo "   or: MAAS_API_KEY=<key> $0"
    echo
    echo "Create an API key via the OpenShift AI Dashboard:"
    echo "  Models-as-a-Service → API Keys → Create API key"
    exit 1
fi

echo "MaaS API URL: $MAAS_URL"
echo

# Test 1: List available models
echo "=== Listing Available Models ==="
curl -s "$MAAS_URL/v1/models" \
  -H "Authorization: Bearer $API_KEY" | jq .

echo
echo

# Test 2: Test granite model (if using Anthropic API format)
echo "=== Testing Granite Model (Anthropic Messages API) ==="
curl -s "$MAAS_URL/v1/messages" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "claude-3-5-haiku-20241022",
    "max_tokens": 100,
    "messages": [{
      "role": "user",
      "content": "Write a one-line Python hello world"
    }]
  }' | jq .

echo
echo

# Test 3: Test qwen model
echo "=== Testing Qwen Model (Anthropic Messages API) ==="
curl -s "$MAAS_URL/v1/messages" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "fable-5-sonnet-20250312",
    "max_tokens": 100,
    "messages": [{
      "role": "user",
      "content": "Explain recursion in one sentence"
    }]
  }' | jq .

echo
echo "All MaaS API tests complete!"
