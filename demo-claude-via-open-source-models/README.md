# Claude Code with Open Source Models on ROSA / ARO

Run Claude Code against open-source LLMs hosted on your own OpenShift cluster, keeping code and prompts within your infrastructure. Swap to Anthropic's Claude API with a single environment variable change when you need maximum quality.

## Architecture

There are two routes into the models on the cluster: **LiteLLM** (with model name aliasing and Anthropic API translation) and **MaaS** (Red Hat-native auth, token quotas, and usage tracking). Both can be used simultaneously.

```
Developer laptop                    OpenShift Cluster (ROSA / ARO)
                                   ┌──────────────────────────────────────────────┐
                                   │                                              │
┌─────────────┐  Anthropic API     │  ┌────────────────┐    ┌──────────────────┐  │
│  Claude Code │──────────────────▶│  │ LiteLLM Gateway│───▶│  MaaS Gateway    │  │
│              │  (model aliasing) │  │ (Anthropic→OAI)│    │  (Kuadrant +     │  │
└──────────────┘                   │  └────────────────┘    │   Authorino)     │  │
                                   │                        │                  │  │
┌─────────────┐  OpenAI API        │                        │  ┌────────────┐  │  │
│  Cursor     │────────────────────│───────────────────────▶│  │ Auth +     │  │  │
│              │  (direct to MaaS) │                        │  │ Quotas     │  │  │
└──────────────┘                   │                        │  └────────────┘  │  │
       │                           │                        └────────┬─────────┘  │
       │ unset                     │                                 │             │
       │ ANTHROPIC_BASE_URL        │                                 ▼             │
       ▼                           │  ┌──────────────┐  ┌──────────────┐          │
┌──────────────┐                   │  │  vLLM        │  │  vLLM        │          │
│ Anthropic API│                   │  │  Granite 30B │  │  Qwen 27B   │          │
│ (direct)     │                   │  │  (GPU node)  │  │  (GPU node)  │          │
└──────────────┘                   │  └──────────────┘  └──────────────┘          │
                                   └──────────────────────────────────────────────┘
                                    OpenShift AI / KServe / MaaS / vLLM
```

**Two routes to models:**

| Route | API | Auth | Features | Best for |
|-------|-----|------|----------|----------|
| **LiteLLM → MaaS** | Anthropic Messages API | LiteLLM API key | Model name aliasing (use `/model` to swap), Anthropic→OpenAI translation | Claude Code |
| **MaaS direct** | OpenAI Chat API | MaaS API key | Per-user token quotas, usage tracking dashboard, Red Hat-native auth | Cursor, multi-user setups |

Both routes pass through the MaaS gateway for authentication and usage tracking before reaching vLLM.

## Why

- **Data protection**: Code and prompts never leave your infrastructure when using the local model
- **Cost management**: Open-source models are free to run (you pay only for compute)
- **Flexibility**: Swap to Claude when the local model can't handle the task
- **Same user experience**: Teams can continue to use the tooling they are already comfortable with

## Models

| Model | Source | Parameters | Quantisation | SWE-bench |
|-------|--------|-----------|-------------|-----------|
| [granite-4.1-30b](https://huggingface.co/ibm-granite/granite-4.1-30b) | IBM Granite | 30B | FP8 (on-the-fly) | — |
| [Qwen3.8-27B-FP8](https://huggingface.co/RedHatAI/Qwen3.8-27B-FP8) | RedHatAI | 27B | FP8 dynamic | — |

### Why these models

- **Granite 4.1 30B** (`ibm-granite/granite-4.1-30b`) — IBM's text-only coding model with 131K context, native tool calling via `--tool-call-parser granite4`, and strong coding benchmarks. BF16 weights are quantised on-the-fly to FP8 by vLLM (`--quantization fp8`). Text-only architecture means no wasted VRAM on vision encoders. Part of the IBM/Red Hat ecosystem.
- **Qwen3.8-27B** (`RedHatAI/Qwen3.8-27B-FP8`) — Successor to Qwen3.6, supports native tool calling via `--tool-call-parser qwen3_coder`, and has 262K token native context. Dense 27B architecture handles agentic coding workflows more reliably than larger MoE models. `--language-model-only` disables the vision encoder to free VRAM for KV cache. `--reasoning-parser qwen3` strips internal `<think>` tags from output. Requires a custom chat template to fix Claude Code compatibility issues (see gotchas in CLAUDE.md).

## Directory Layout

```
cluster-setup/          Cluster prerequisites (operators, RHOAI configuration)
  operators/            Operator subscriptions (NFD, NVIDIA GPU, cert-manager, COO, OTel, RHOAI)
  ai-project/           Namespace, DataScienceCluster, and vLLM ServingRuntime
models/                 Model PVCs, download jobs, chat templates, LLMInferenceServices
maas/                   MaaS infrastructure (RHCL, Kuadrant, Authorino, PostgreSQL, gateway, auth)
litellm-gateway/        LiteLLM API translation layer (Anthropic ↔ OpenAI)
alternatives/           Alternative approaches (direct vLLM without MaaS)
docs/                   Documentation and blog posts
```

## Prerequisites

- A ROSA (AWS) or ARO (Azure) cluster with GPU machine pool(s)
  - ROSA: Use `../andys-demo-cluster-tf` with `ai_rosa.tfvars` (set GPU pool replicas to 2)
  - ARO: Ensure GPU quota is available (e.g. `Standard_NC24ads_A100_v4` or `Standard_NV36ads_A10_v5`)
- `oc` CLI logged into the cluster as cluster-admin
- A [HuggingFace account](https://huggingface.co) with an access token (free)
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed on your laptop

### GPU Requirements

Both models require a GPU with at least 24GB VRAM (FP8 quantisation). Running both simultaneously needs 2 GPU nodes. The g7e.2xlarge (96GB) provides significant headroom for large context windows.

| Platform | Instance Type | GPU | VRAM |
|----------|--------------|-----|------|
| ROSA (AWS) | `g5.2xlarge` | A10G | 24GB |
| ROSA (AWS) | `g7e.2xlarge` | RTX PRO 6000 | 96GB |
| ARO (Azure) | `Standard_NC24ads_A100_v4` | A100 | 80GB |
| ARO (Azure) | `Standard_NV36ads_A10_v5` | A10 | 24GB |

## Installation

### Step 1: Provision the Cluster

**ROSA (using existing terraform):**

```bash
cd ../andys-demo-cluster-tf
# Edit ai_rosa.tfvars to set GPU pool replicas to 2
terraform apply -var-file=ai_rosa.tfvars
```

**ARO:**

Ensure your ARO cluster has a GPU machine pool. Refer to the `aro/` module in `andys-demo-cluster-tf` or create one via the Azure portal.

### Step 2: Install Prerequisite Operators

```bash
# cert-manager (required by RHOAI v3)
oc apply -f cluster-setup/operators/cert-manager.yaml
oc wait --for=condition=Available deployment -n cert-manager-operator --all --timeout=300s

# Cluster Observability Operator (required for MaaS usage dashboards)
oc apply -f cluster-setup/operators/cluster-observability-operator.yaml

# Red Hat build of OpenTelemetry (required for MaaS metrics collection)
oc apply -f cluster-setup/operators/opentelemetry.yaml
```

### Step 3: Install GPU Operators

```bash
# Node Feature Discovery
oc apply -f cluster-setup/operators/nfd.yaml
oc wait --for=condition=Available deployment -n openshift-nfd --all --timeout=300s

# NFD Instance (discovers GPU hardware)
oc apply -f cluster-setup/operators/nfd-instance.yaml

# NVIDIA GPU Operator
oc apply -f cluster-setup/operators/nvidia-gpu-operator.yaml
oc wait --for=condition=Available deployment -n nvidia-gpu-operator --all --timeout=300s

# NVIDIA ClusterPolicy (installs GPU drivers on nodes)
oc apply -f cluster-setup/operators/nvidia-cluster-policy.yaml
```

Wait for GPU driver pods to be ready on the GPU nodes:

```bash
oc get pods -n nvidia-gpu-operator -l app=nvidia-driver-daemonset -w
```

Verify GPUs are discovered:

```bash
oc get nodes -l nvidia.com/gpu.present=true
```

### Step 4: Install Red Hat OpenShift AI

```bash
oc apply -f cluster-setup/operators/rhoai.yaml
oc wait --for=condition=Available deployment -n redhat-ods-operator --all --timeout=600s
```

### Step 5: Configure OpenShift AI

```bash
# Create the project namespace
oc apply -f cluster-setup/ai-project/namespace.yaml

# Deploy the DataScienceCluster (enables KServe + MaaS via aigateway)
oc apply -f cluster-setup/ai-project/data-science-cluster.yaml
```

Wait for KServe to be fully ready (this can take several minutes on first install):

```bash
oc wait --for=condition=Available deployment/kserve-controller-manager \
  -n redhat-ods-applications --timeout=600s
```

Then deploy the vLLM ServingRuntime:

```bash
oc apply -f cluster-setup/ai-project/serving-runtime.yaml
```

### Step 6: Set Up MaaS Infrastructure

MaaS provides Red Hat-native API key authentication, per-user token quotas, and usage tracking. All commands in this step use files from the `maas/` directory.

```bash
# Enable User Workload Monitoring (for Prometheus metrics)
oc apply -f maas/monitoring.yaml

# Install Red Hat Connectivity Link (provides Kuadrant + Authorino)
oc apply -f maas/operator.yaml
oc get csv -n openshift-operators -w
# Wait for rhcl-operator to show "Succeeded"

# Create Kuadrant instance
oc apply -f maas/kuadrant.yaml
oc wait --for=condition=Ready kuadrant/kuadrant -n kuadrant-system --timeout=300s

# Set up Authorino (API key validation)
oc apply -f maas/authorino.yaml
```

Deploy PostgreSQL (MaaS stores API keys and subscriptions here):

```bash
# Generate a password and update postgres.yaml
PG_PASSWORD=$(openssl rand -base64 16 | tr -d '=+/')
echo "PostgreSQL password: $PG_PASSWORD"
# Replace BOTH instances of REPLACE_WITH_GENERATED_PASSWORD in maas/postgres.yaml

oc apply -f maas/postgres.yaml
oc wait --for=condition=Available deployment/postgres \
  -n redhat-ods-applications --timeout=120s
```

Create the MaaS gateway:

```bash
# Label namespace for gateway access
oc apply -f maas/namespace-label.yaml

# Create the gateway
oc apply -f maas/gateway.yaml
oc wait --for=condition=Programmed gateway/maas-default-gateway \
  -n openshift-ingress --timeout=120s
```

Enable Gen AI Studio in the dashboard:

```bash
oc patch odhdashboardconfig odh-dashboard-config \
  -n redhat-ods-applications --type=merge \
  -p '{"spec":{"dashboardConfig":{"genAiStudio":true,"observabilityDashboard":true}}}'
```

### Step 7: Download and Deploy Models

Create a HuggingFace token secret (this file is gitignored to prevent accidental credential leaks):

```bash
# Edit models/hf-token-secret.yaml and replace REPLACE_WITH_YOUR_HF_TOKEN
oc apply -f models/hf-token-secret.yaml

# Create PVCs and start downloads
oc apply -f models/granite-pvc.yaml
oc apply -f models/qwen3-8-pvc.yaml
oc apply -f models/granite-download-job.yaml
oc apply -f models/qwen3-8-download-job.yaml
```

Monitor download progress:

```bash
# Granite (~30-45 minutes, BF16 weights are ~60GB)
oc logs -f job/download-granite-4-1-30b -n claude-code-demo

# Qwen (~20-30 minutes)
oc logs -f job/download-qwen3-8-27b -n claude-code-demo
```

Once downloads complete, deploy the chat template and LLMInferenceServices:

```bash
# Qwen needs a custom chat template because the default rejects system
# messages mid-conversation (which Claude Code sends for tool context).
# Granite uses its built-in template and needs no override.
oc apply -f models/qwen-chat-template.yaml
oc apply -f models/granite-llm-inference-service.yaml
oc apply -f models/qwen3-8-llm-inference-service.yaml
```

Wait for models to load:

```bash
oc get llminferenceservice -n claude-code-demo -w
# Both should show READY=True after ~5 minutes
```

### Step 8: Register Models and Create User Access

Register the models with MaaS, create a user group, and set up token quotas:

```bash
# Register models with MaaS
oc apply -f maas/model-refs.yaml

# Create auth policy granting access to the user group
oc apply -f maas/auth-policy.yaml

# Create user group and add yourself
oc adm groups new claude-code-users
oc adm groups add-users claude-code-users $(oc whoami)

# Create subscription with token limits
oc apply -f maas/subscription.yaml
```

Verify:

```bash
oc get maasmodelrefs -n claude-code-demo
oc get maasauthpolicies -n models-as-a-service
oc get maassubscriptions -n models-as-a-service
```

Create a MaaS API key (for direct Cursor access):

```bash
CLUSTER_DOMAIN=$(oc get ingresses.config.openshift.io cluster -o jsonpath='{.spec.domain}')
MAAS_API="https://maas.${CLUSTER_DOMAIN}/maas-api"

MAAS_KEY=$(curl -sS \
  -H "Authorization: Bearer $(oc whoami -t)" \
  -H "Content-Type: application/json" \
  -X POST \
  -d '{
    "name": "claude-code-key",
    "description": "API key for Claude Code demo",
    "subscription": "claude-code-demo-subscription"
  }' \
  "${MAAS_API}/v1/api-keys" | jq -r .key)

echo "Your MaaS API key: $MAAS_KEY"
echo "Save this — it is only shown once."
```

### Step 9: Deploy the LiteLLM Gateway

Claude Code uses the Anthropic Messages API, which requires a translation layer to reach vLLM's OpenAI-compatible backend. LiteLLM handles this and provides model name aliasing.

Generate a LiteLLM API key and deploy:

```bash
export LITELLM_KEY="sk-$(openssl rand -hex 24)"
echo "Your LiteLLM API key: $LITELLM_KEY"
echo "Save this — you'll need it for Claude Code configuration."

oc create secret generic litellm-api-key \
  --from-literal=master-key="$LITELLM_KEY" \
  -n claude-code-demo

oc apply -f litellm-gateway/litellm-config.yaml
oc apply -f litellm-gateway/litellm-deployment.yaml
oc apply -f litellm-gateway/litellm-service.yaml
oc apply -f litellm-gateway/litellm-route.yaml

oc wait --for=condition=Available deployment/litellm-gateway -n claude-code-demo --timeout=120s
```

### Step 10: Apply Streaming Timeout Fixes

The MaaS gateway has default timeouts that kill long-running streaming responses. Apply these fixes:

```bash
# Stream idle timeout override (sets to infinite)
oc apply -f maas/stream-timeout-envoyfilter.yaml

# Payload processing timeout override (MaaS controller sets 300s, this overrides to infinite)
oc apply -f maas/payload-processing-timeout-override.yaml
```

### Step 11: Test the Setup

The first request to each model may be slow (30-60s) while vLLM compiles CUDA graphs. Send a warm-up request first.

```bash
export GATEWAY_URL=$(oc get route litellm-gateway -n claude-code-demo -o jsonpath='{.spec.host}')

# Warm up (ignore errors on first attempt)
curl -s -X POST "https://$GATEWAY_URL/v1/messages" \
  -H "x-api-key: $LITELLM_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{"model": "claude-sonnet-4-20250514", "max_tokens": 16, "messages": [{"role": "user", "content": "Hi"}]}'

curl -s -X POST "https://$GATEWAY_URL/v1/messages" \
  -H "x-api-key: $LITELLM_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{"model": "claude-opus-4-20250514", "max_tokens": 16, "messages": [{"role": "user", "content": "Hi"}]}'
```

**Test Granite:**

```bash
curl -s -X POST "https://$GATEWAY_URL/v1/messages" \
  -H "x-api-key: $LITELLM_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "granite-4-1-30b",
    "max_tokens": 256,
    "messages": [{"role": "user", "content": "Write a Python hello world program"}]
  }' | python3 -m json.tool
```

**Test Qwen:**

```bash
curl -s -X POST "https://$GATEWAY_URL/v1/messages" \
  -H "x-api-key: $LITELLM_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen3-8-27b",
    "max_tokens": 256,
    "messages": [{"role": "user", "content": "Write a Python function to reverse a linked list"}]
  }' | python3 -m json.tool
```

Both should return responses from their respective local models.

## Running the Demo: Configuring Claude Code

### Using the Open-Source Models

```bash
export ANTHROPIC_BASE_URL="https://$(oc get route litellm-gateway -n claude-code-demo -o jsonpath='{.spec.host}')"
export ANTHROPIC_API_KEY="$LITELLM_KEY"

# Launch Claude Code
claude
```

Check that Claude Code is connected to your gateway:

```
/status
```

You should see the `Anthropic base URL` pointing to your cluster route.

### Switching Models Within Claude Code (No Restart Required)

Use the `/model` command inside Claude Code to switch between local models without restarting:

```
/model
```

Select from the model picker:
- **Sonnet** → routes to Granite 4.1 30B on your cluster
- **Opus** → routes to Qwen3.8-27B on your cluster

The LiteLLM gateway maps Claude model names to local vLLM endpoints, so switching models in Claude Code transparently switches which open-source model handles your requests.

### Model Mapping

vLLM serves the models with their **real names** as primary identifiers, with Claude model names as aliases:

| Model you select | vLLM serves as | Routes to |
|------------------|----------------|-----------|
| `granite-4-1-30b` | `granite-4-1-30b` | IBM Granite 4.1 30B (30B params, FP8) |
| `qwen3-8-27b` | `qwen3-8-27b` | Qwen 3.8 27B FP8 (27B params, FP8) |
| `claude-sonnet-5` | `granite-4-1-30b` | Granite (alias via LiteLLM) |
| `claude-haiku-4-5-20251001` | `granite-4-1-30b` | Granite (alias via LiteLLM) |
| `claude-opus-5` | `qwen3-8-27b` | Qwen (alias via LiteLLM) |
| `claude-fable-5` | `qwen3-8-27b` | Qwen (alias via LiteLLM) |

**Recommendation:** Use the real model names (`granite-4-1-30b`, `qwen3-8-27b`) for clarity. The Claude aliases are provided for convenience when switching between local and Anthropic models.

You can modify `litellm-gateway/litellm-config.yaml` to change these mappings or add more models. The config uses the `hosted_vllm/` LiteLLM provider prefix for optimal vLLM compatibility, with `drop_params: true` to silently handle Anthropic-specific parameters that vLLM doesn't support.

### Using with Cursor

Cursor uses the OpenAI Chat Completions API, so it can connect either through LiteLLM or directly to MaaS.

**Option 1: Via LiteLLM** (same gateway as Claude Code)

In Cursor, go to **Settings → Models → OpenAI API** and configure:

- **Base URL**: `https://<litellm-gateway-url>/v1`
- **API Key**: your LiteLLM API key
- **Model**: `granite-4-1-30b` or `qwen3-8-27b`

**Option 2: Via MaaS direct** (per-user auth and token quotas)

- **Base URL**: `https://<maas-gateway-url>/v1`
- **API Key**: your MaaS API key (from `MaaSSubscription`)
- **Model**: `granite-4-1-30b` or `qwen3-8-27b`

```bash
# Get gateway URLs
echo "LiteLLM: https://$(oc get route litellm-gateway -n claude-code-demo -o jsonpath='{.spec.host}')/v1"
echo "MaaS:    https://$(oc get route -n openshift-ingress -l maas.opendatahub.io/gateway=maas-default-gateway -o jsonpath='{.items[0].spec.host}')/v1"
```

MaaS direct is recommended for multi-user setups as it provides per-user token quotas and usage tracking without requiring LiteLLM.

### Switching Back to Anthropic Claude

To use the real Anthropic API instead of your local models, exit Claude Code and unset the gateway variables:

```bash
unset ANTHROPIC_BASE_URL
unset ANTHROPIC_API_KEY

# Relaunch Claude Code — it will use your saved login or default API key
claude
```

## Testing

### Infrastructure Checks

```bash
# GPU nodes are ready
oc get nodes -l nvidia.com/gpu.present=true

# GPU operator is healthy
oc get pods -n nvidia-gpu-operator | grep -v Completed

# Models are serving
oc get llminferenceservice -n claude-code-demo

# Gateway is healthy
oc get pods -n claude-code-demo -l app=litellm-gateway
```

### Coding Tasks to Compare

Run each task three times: once with Granite (select Sonnet via `/model`), once with Qwen (select Opus via `/model`), and once with real Anthropic Claude (unset `ANTHROPIC_BASE_URL` and relaunch).

1. "Write a Python function to find all prime numbers up to N using the Sieve of Eratosthenes"
2. "Read the README.md and summarise what this project does" (tests tool use)
3. "Refactor this function to use async/await" (with a sample file)
4. "Write unit tests for this module" (tests understanding of testing frameworks)
5. "Find and fix the bug in this code" (with a deliberately buggy sample)

For tasks 1-5, switch between Granite and Qwen inside the same Claude Code session using `/model` — no restart needed. Only switching to/from the real Anthropic API requires relaunching.

### Known Limitations with Open-Source Models

- **Tool use**: File reading, editing, and bash commands may not work reliably — these require the model to emit correctly formatted tool calls. Qwen3.8 has native tool calling support via `qwen3_coder` and Granite 4.1 via `granite4`, which handle most straightforward tool calls. Complex multi-tool chains are where quality drops off compared to Claude
- **Web search**: Claude Code's built-in web search is a native Anthropic API feature and is not available with open-source models. Attempting it will produce an error. There is no workaround — web search requires Anthropic's backend. However, in testing, the model reliably falls back onto the Fetch method, which works the same.
- **Extended thinking**: Claude's extended thinking feature is not available. Qwen3.8 has its own reasoning mode (`<think>` tags) which is stripped from output by `--reasoning-parser qwen3`. Claude Code sends `reasoning_effort: "high"` which the custom chat template maps to `medium` (vLLM only accepts `xhigh`/`medium`/`low`, and `xhigh` causes empty responses ~17% of the time)
- **System messages mid-conversation**: Claude Code sends system messages mid-conversation for tool context. Both Qwen and Granite's default chat templates reject this. Fixed with a custom chat template (`models/qwen-chat-template.yaml`) that allows system messages anywhere. Granite's built-in template handles this natively
- **Prompt caching**: Not available — all tokens are processed on every request. This increases latency and GPU utilisation compared to Claude's cached prompt handling
- **Long context**: Granite is configured for 131K tokens, Qwen for 262K (vs Claude's 200K). Context is comparable, but without prompt caching, long contexts are more expensive to process
- **Multi-step reasoning**: Open-source models may struggle with complex, multi-tool workflows that require planning across many steps. Single-step tasks (code generation, file edits, explanations) work well
- **First request latency**: vLLM compiles CUDA graphs on the first request after startup, causing 30-60 second delays. Step 11 includes a warm-up step to trigger this before you start using Claude Code
- **Streaming timeouts**: The MaaS gateway's payload processing has 300s default timeouts that kill long-running responses. Step 10 applies EnvoyFilter overrides to disable these. LiteLLM is configured with a 180s per-request timeout and 2 retries, so transient failures recover in ~3 minutes instead of hanging for 10

## Usage Monitoring (MaaS)

RHOAI provides built-in Perses dashboards for monitoring token usage, authorized calls, and rate limiting per user and model. The Cluster Observability Operator and OpenTelemetry operator are already installed (Step 2). Two additional patches enable the dashboards.

### Configure Metrics in DSCI

Patch the DSCInitialization to enable metrics collection with storage. This triggers the RHOAI operator to auto-create the MonitoringStack, Perses server, Prometheus, and Thanos querier in `redhat-ods-monitoring`:

```bash
oc patch dsci default-dsci --type=merge -p '
spec:
  monitoring:
    metrics:
      storage:
        retention: "7d"
        size: "5Gi"
'
```

Wait for the monitoring stack and Perses to become available:

```bash
oc get dsci default-dsci -o yaml | grep -A 3 'MonitoringStackAvailable\|PersesAvailable'
# Both should show status: "True"
```

### Enable MaaS Telemetry

Patch the MaasTenantConfig to enable per-user and per-model usage metrics:

```bash
oc patch maastenantconfig default-tenant -n models-as-a-service --type=merge -p '
spec:
  telemetry:
    enabled: true
    metrics:
      captureModelUsage: true
      captureUser: true
'
```

> **Note:** Enabling `captureUser` logs user identity per request — ensure GDPR/privacy compliance before enabling in production.

### Accessing the Dashboard

The `observabilityDashboard` flag was enabled in Step 6. The MaaS usage dashboard is available in the OpenShift AI console at **Observe & monitor → Dashboard**. It shows:

- **Authorized calls** per model and user
- **Token usage** (input/output) per model
- **Rate-limited requests** when token quotas are exceeded
- **Request latency** breakdown

The dashboards are auto-managed Perses dashboards (`PersesDashboard` resources in `redhat-ods-monitoring`). There are no CLI or REST API endpoints for usage data — the dashboard is the only interface in RHOAI 3.5.


## Alternative Approaches

### Direct vLLM (No MaaS)

vLLM natively supports the Anthropic Messages API, so Claude Code can connect directly without MaaS authentication. This simplifies the architecture but loses usage tracking and multi-user support. See **[alternatives/direct-vllm/README.md](alternatives/direct-vllm/README.md)** for setup.

## Cleanup

```bash
# Remove LiteLLM gateway
oc delete -f litellm-gateway/

# Remove MaaS access and timeout fixes
oc delete -f maas/subscription.yaml
oc delete -f maas/auth-policy.yaml
oc delete -f maas/model-refs.yaml
oc delete envoyfilter maas-payload-processing-timeout-override -n openshift-ingress
oc delete -f maas/stream-timeout-envoyfilter.yaml

# Remove LLMInferenceServices and chat templates
oc delete -f models/granite-llm-inference-service.yaml
oc delete -f models/qwen3-8-llm-inference-service.yaml
oc delete -f models/qwen-chat-template.yaml

# Remove download jobs and PVCs
oc delete -f models/granite-download-job.yaml
oc delete -f models/qwen3-8-download-job.yaml
oc delete -f models/granite-pvc.yaml
oc delete -f models/qwen3-8-pvc.yaml

# Remove MaaS infrastructure
oc delete -f maas/gateway.yaml
oc delete -f maas/postgres.yaml
oc delete -f maas/authorino.yaml
oc delete -f maas/kuadrant.yaml
oc delete -f maas/operator.yaml

# Remove AI project
oc delete -f cluster-setup/ai-project/serving-runtime.yaml
oc delete -f cluster-setup/ai-project/data-science-cluster.yaml
oc delete -f cluster-setup/ai-project/namespace.yaml

# Remove operators (optional — other workloads may depend on these)
oc delete -f cluster-setup/operators/nvidia-cluster-policy.yaml
oc delete -f cluster-setup/operators/nvidia-gpu-operator.yaml
oc delete -f cluster-setup/operators/nfd-instance.yaml
oc delete -f cluster-setup/operators/nfd.yaml
oc delete -f cluster-setup/operators/opentelemetry.yaml
oc delete -f cluster-setup/operators/cluster-observability-operator.yaml
oc delete -f cluster-setup/operators/rhoai.yaml

# Tear down the cluster (if using terraform)
cd ../andys-demo-cluster-tf
terraform destroy -var-file=ai_rosa.tfvars
```

## Troubleshooting

### GPU nodes not found

Check that the machine pool has been created and nodes are ready:

```bash
oc get machinesets -A
oc get nodes --show-labels | grep gpu
```

### Model download fails

Check the HuggingFace token is valid and the model is accessible:

```bash
oc get secret hf-token -n claude-code-demo -o jsonpath='{.data.token}' | base64 -d
oc logs job/download-granite-4-1-30b -n claude-code-demo
```

### First request is very slow

This is normal. vLLM compiles CUDA graphs and warms up the KV cache on the first request after startup, which can take 30-60 seconds. Subsequent requests will be much faster. The warm-up step in Step 8 triggers this so it's done before you start using Claude Code.

### vLLM pod crashes (OOM)

The model may be too large for the available GPU VRAM. Check:

```bash
oc logs <vllm-pod> -n claude-code-demo
```

If OOM, reduce `--max-model-len` in the InferenceService args or use a GPU with more VRAM.

### LiteLLM returns errors

Check the gateway logs and verify the vLLM services are reachable:

```bash
oc logs deployment/litellm-gateway -n claude-code-demo
oc get svc -n claude-code-demo
```

### Claude Code doesn't connect

Verify environment variables are set:

```bash
echo $ANTHROPIC_BASE_URL
echo $ANTHROPIC_API_KEY
```

Run `/status` inside Claude Code to check the connection.

### Streaming responses cut off after 30-60 seconds (MaaS only)

**Symptom:** Connections drop mid-stream with `ServerDisconnectedError` or `TransferEncodingError`.

**Cause:** Kuadrant operator reconciliation loop bug (fixed upstream in Kuadrant v1.5.3, should be resolved in RHOAI 3.5).

**Fix:** If still occurring on RHOAI 3.5, scale down the Kuadrant operator:
```bash
oc scale deployment/kuadrant-operator-controller-manager -n openshift-operators --replicas=0
```

See **[docs/kuadrant-reconciliation-loop-bug.md](docs/kuadrant-reconciliation-loop-bug.md)** for complete details, verification steps, and permanent solutions.
