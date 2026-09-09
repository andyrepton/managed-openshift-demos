# Test Scripts

Convenience scripts for testing your models and MaaS API.

## Available Scripts

### test-models.sh

Tests models via the LiteLLM gateway.

**Usage:**
```bash
# Test all configured models
./scripts/test-models.sh

# Test a specific model
./scripts/test-models.sh claude-sonnet-5

# Test with custom prompt
./scripts/test-models.sh claude-opus-5 "Write a function to parse JSON"
```

**What it does:**
- Retrieves gateway URL and API key from the cluster
- Warms up models (first request is always slow due to CUDA graph compilation)
- Sends test prompts to each model
- Displays responses and token usage

**Requirements:**
- Must be logged into the cluster (`oc login`)
- LiteLLM gateway must be deployed
- Models must be running and ready

---

### test-maas-api.sh

Tests the MaaS API directly (bypassing LiteLLM).

**Usage:**
```bash
# Using API key from argument
./scripts/test-maas-api.sh sk-oai-your-api-key-here

# Using API key from environment
export MAAS_API_KEY="sk-oai-your-api-key-here"
./scripts/test-maas-api.sh
```

**What it does:**
- Lists available models via `/v1/models` endpoint
- Tests both models using Anthropic Messages API format
- Shows token usage and rate limit headers

**Requirements:**
- Must be logged into the cluster (`oc login`)
- MaaS must be deployed with API key created
- Models must be deployed as LLMInferenceServices

**Creating an API key:**
1. Open the OpenShift AI Dashboard
2. Navigate to **Models-as-a-Service** → **API Keys**
3. Click **Create API key**
4. Set expiration (or leave blank for no expiry)
5. Copy the generated key (shown only once!)

---

## Quick Testing Workflow

After deploying everything:

```bash
# 1. Test via LiteLLM gateway (Anthropic API format)
./scripts/test-models.sh

# 2. Test MaaS API directly (requires API key from dashboard)
export MAAS_API_KEY="sk-oai-..."
./scripts/test-maas-api.sh

# 3. Test Claude Code connection
export ANTHROPIC_BASE_URL="https://$(oc get route litellm-gateway -n claude-code-demo -o jsonpath='{.spec.host}')"
export ANTHROPIC_API_KEY="$(oc get secret litellm-api-key -n claude-code-demo -o jsonpath='{.data.master-key}' | base64 -d)"
claude
```

Inside Claude Code:
```
/status          # Check connection
/model           # Switch between models
```

---

## Troubleshooting

### "Could not retrieve gateway URL"
- Check you're logged into the cluster: `oc whoami`
- Verify the gateway is deployed: `oc get route litellm-gateway -n claude-code-demo`

### First request takes 30-60 seconds
This is normal. vLLM compiles CUDA graphs on the first request after startup. The test scripts include a warm-up step to handle this.

### "429 Too Many Requests"
You've hit the MaaS token rate limit. Check your subscription configuration in `maas/subscription.yaml` and increase the `tokenRateLimits` if needed.

### Model returns empty response
- Check the model pod logs: `oc logs <model-name>-predictor-xxx -n claude-code-demo`
- Verify the model is READY: `oc get inferenceservice -n claude-code-demo`
- Check vLLM arguments match the model (correct `--tool-call-parser`, `--chat-template`, etc.)

### "Authentication Error"
- For LiteLLM: The API key is stored in a secret. Retrieve it with:
  ```bash
  oc get secret litellm-api-key -n claude-code-demo -o jsonpath='{.data.master-key}' | base64 -d
  ```
- For MaaS: You must create an API key via the dashboard (cannot be retrieved after creation)
