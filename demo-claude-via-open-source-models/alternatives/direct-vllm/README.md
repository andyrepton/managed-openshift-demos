# Native vLLM Anthropic API (No LiteLLM)

vLLM now natively supports the Anthropic Messages API (`/v1/messages`), which means Claude Code can talk directly to vLLM without LiteLLM as a translation layer. This simplifies the architecture from:

```
Claude Code -> LiteLLM -> vLLM -> Model
```

to:

```
Claude Code -> vLLM -> Model
```

No additional gateway, no API format translation, pure Red Hat stack.

## Prerequisites

The base demo must already be deployed:

- Operators installed (`operators/`)
- OpenShift AI configured (`ai-project/`)
- At least one model deployed as an InferenceService (`models/`)

The existing InferenceServices (`granite-4-1-30b` and `qwen3-6-27b`) and ServingRuntime (`vllm-cuda-runtime`) work as-is. The vLLM version shipped with RHOAI v3 (3.3+) includes the Anthropic API endpoint by default -- no ServingRuntime changes are needed.

## Exposing vLLM via Route

Apply the route for whichever model you want to use:

```bash
# Both models
oc apply -f gateway-route.yaml

# Or just one
oc apply -f gateway-route.yaml -l app=vllm-gateway
```

Get the route hostname:

```bash
# Granite
oc get route vllm-granite-gateway -n claude-code-demo -o jsonpath='{.spec.host}'

# Qwen
oc get route vllm-qwen-gateway -n claude-code-demo -o jsonpath='{.spec.host}'
```

Verify the Anthropic API is working:

```bash
ROUTE=$(oc get route vllm-granite-gateway -n claude-code-demo -o jsonpath='{.spec.host}')
curl -s https://${ROUTE}/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: dummy" \
  -d '{
    "model": "granite-4-1-30b",
    "max_tokens": 100,
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

## Configuring Claude Code

Set these environment variables before launching `claude`:

```bash
# Point Claude Code at the vLLM route
export ANTHROPIC_BASE_URL="https://$(oc get route vllm-granite-gateway -n claude-code-demo -o jsonpath='{.spec.host}')"
export ANTHROPIC_API_KEY="dummy"
export ANTHROPIC_AUTH_TOKEN="dummy"
export CLAUDE_CODE_SKIP_AUTH_LOGIN=1

# Map all Claude model tiers to the vLLM model name
export ANTHROPIC_DEFAULT_OPUS_MODEL="granite-4-1-30b"
export ANTHROPIC_DEFAULT_SONNET_MODEL="granite-4-1-30b"
export ANTHROPIC_DEFAULT_HAIKU_MODEL="granite-4-1-30b"
```

Or add them to `~/.claude/settings.local.json`:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://vllm-granite-gateway-claude-code-demo.apps.<cluster-domain>",
    "ANTHROPIC_API_KEY": "dummy",
    "ANTHROPIC_AUTH_TOKEN": "dummy",
    "CLAUDE_CODE_SKIP_AUTH_LOGIN": "1",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "granite-4-1-30b",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "granite-4-1-30b",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "granite-4-1-30b"
  }
}
```

Then run `claude` as normal.

## Switching between models

Unlike the LiteLLM approach where a single endpoint routes to different models based on model name, with native vLLM each model has its own route.

**To switch models**, change `ANTHROPIC_BASE_URL` and the `ANTHROPIC_DEFAULT_*_MODEL` variables:

```bash
# Use Qwen instead
export ANTHROPIC_BASE_URL="https://$(oc get route vllm-qwen-gateway -n claude-code-demo -o jsonpath='{.spec.host}')"
export ANTHROPIC_DEFAULT_OPUS_MODEL="qwen3-6-27b"
export ANTHROPIC_DEFAULT_SONNET_MODEL="qwen3-6-27b"
export ANTHROPIC_DEFAULT_HAIKU_MODEL="qwen3-6-27b"
```

You can also map different tiers to different models by using separate routes:

```bash
# Opus/Sonnet -> Qwen (stronger coding), Haiku -> Granite (faster)
export ANTHROPIC_DEFAULT_OPUS_MODEL="qwen3-6-27b"
export ANTHROPIC_DEFAULT_SONNET_MODEL="qwen3-6-27b"
export ANTHROPIC_DEFAULT_HAIKU_MODEL="granite-4-1-30b"
```

Note: `ANTHROPIC_BASE_URL` can only point to one endpoint, so multi-model routing from a single Claude Code session still requires either LiteLLM or the MaaS gateway (see below).

## Authentication options

The native vLLM approach has no built-in auth. The routes above are publicly accessible (TLS-encrypted but unauthenticated). Here are options for adding auth:

### Option 1: OpenShift AI Models-as-a-Service (MaaS) -- Recommended

RHOAI 3.5 includes a Models-as-a-Service feature that provides enterprise-grade API key authentication, rate limiting, and usage tracking. This is the recommended auth approach for a full Red Hat stack.

See **[maas/README.md](maas/README.md)** for the complete setup guide with YAML manifests.

### Option 2: OpenShift OAuth Proxy sidecar

Add an `oauth-proxy` sidecar to the vLLM deployment that requires a valid OpenShift token. This is simpler than MaaS but only supports OpenShift user authentication, not API keys.

### Option 3: Route-level basic auth

Use an OpenShift Route with a passthrough TLS termination and an nginx reverse proxy that handles basic auth. Simple but not production-grade.

### Option 4: Keep using LiteLLM

If you need auth now without the MaaS infrastructure, the main demo's LiteLLM gateway provides API key auth out of the box via its `LITELLM_MASTER_KEY`.

## Limitations vs the LiteLLM approach

| Feature | Native vLLM | LiteLLM Gateway |
|---|---|---|
| API format translation | Built-in | LiteLLM handles it |
| Multi-model routing | One route per model | Single endpoint, routes by model name |
| API key auth | None (needs MaaS or proxy) | Built-in master key |
| Usage tracking | None (needs MaaS) | Built-in logging |
| Rate limiting | None (needs MaaS) | Built-in |
| Drop unsupported params | vLLM ignores them | `drop_params: true` |
| Components to manage | Just OpenShift Route | LiteLLM Deployment + ConfigMap + Secret |
| Model name mapping | `ANTHROPIC_DEFAULT_*_MODEL` env vars | LiteLLM config maps all Claude model IDs |

## Cursor / OpenAI-compatible clients

vLLM serves both the Anthropic Messages API (`/v1/messages`) and the OpenAI Chat Completions API (`/v1/chat/completions`) on the same port simultaneously. This means the same vLLM deployment supports both Claude Code and Cursor (or any OpenAI-compatible tool) without any configuration changes.

For Cursor, configure a custom OpenAI-compatible provider:

```
API Base URL: https://vllm-granite-gateway-claude-code-demo.apps.<cluster-domain>/v1
API Key: dummy
Model: granite-4-1-30b
```

## Prefix caching note

Claude Code injects a per-request hash in the system prompt that can defeat vLLM's prefix caching, causing reduced performance. This is fixed automatically in vLLM versions > 0.17.1. For older versions, disable it:

```json
{
  "env": {
    "CLAUDE_CODE_ATTRIBUTION_HEADER": "0"
  }
}
```

## References

- [vLLM Claude Code integration docs](https://docs.vllm.ai/en/latest/serving/integrations/claude_code/)
- [Claude Code on OpenShift with vLLM (Piotr Minkowski)](https://piotrminkowski.com/2026/02/27/claude-code-on-openshift-with-vllm-and-dev-spaces/)
- [RHOAI Models-as-a-Service docs](https://docs.redhat.com/en/documentation/red_hat_openshift_ai_self-managed/3.5/html/govern_llm_access_with_models-as-a-service/)
- [MaaS API key management blog](https://www.redhat.com/en/blog/protecting-enterprise-ai-how-manage-api-keys-models-service-maas)
- [vLLM Anthropic API PR #22627](https://github.com/vllm-project/vllm/pull/22627)
