# Claude Code with Open Source Models on ROSA / ARO

Run Claude Code against open-source LLMs hosted on your own OpenShift cluster, keeping code and prompts within your infrastructure. Swap to Anthropic's Claude API with a single environment variable change when you need maximum quality.

## Architecture

```
Developer laptop                    OpenShift Cluster (ROSA / ARO)
┌─────────────┐                    ┌──────────────────────────────────────┐
│  Claude Code │─── Anthropic ────▶│  LiteLLM Gateway                    │
│              │   Messages API    │  (serves both Anthropic & OpenAI)   │
└──────────────┘                   │         │                           │
┌─────────────┐                    │         │                           │
│  Cursor     │─── OpenAI ────────▶│         │                           │
│              │   Chat API        │         ▼ OpenAI Chat API           │
└──────────────┘                   │  ┌──────────────┐ ┌──────────────┐ │
       │                           │  │  vLLM        │ │  vLLM        │ │
       │ unset                     │  │  Granite 30B │ │  Qwen 27B   │ │
       │ ANTHROPIC_BASE_URL        │  │  (GPU node)  │ │  (GPU node)  │ │
       ▼                           │  └──────────────┘ └──────────────┘ │
┌──────────────┐                   └──────────────────────────────────────┘
│ Anthropic API│                    OpenShift AI / KServe / vLLM
│ (direct)     │
└──────────────┘
```

**LiteLLM** acts as a unified gateway serving both the Anthropic Messages API (for Claude Code) and the OpenAI Chat Completions API (for Cursor and other OpenAI-compatible tools). All requests are forwarded to vLLM's OpenAI-compatible backend.

## Why

- **Data protection**: Code and prompts never leave your infrastructure when using the local model
- **Cost management**: Open-source models are free to run (you pay only for compute)
- **Flexibility**: Swap to Claude when the local model can't handle the task

## Models

| Model | Source | Parameters | Quantisation | SWE-bench |
|-------|--------|-----------|-------------|-----------|
| [granite-4.1-30b](https://huggingface.co/ibm-granite/granite-4.1-30b) | IBM Granite | 30B | FP8 (on-the-fly) | — |
| [Qwen3.6-27B-FP8](https://huggingface.co/RedHatAI/Qwen3.6-27B-FP8) | RedHatAI | 27B | FP8 dynamic | 77.2% |

### Why these models

- **Granite 4.1 30B** (`ibm-granite/granite-4.1-30b`) — IBM's text-only coding model with 131K context, native tool calling via `--tool-call-parser granite4`, and strong coding benchmarks. BF16 weights are quantised on-the-fly to FP8 by vLLM (`--quantization fp8`). Text-only architecture means no wasted VRAM on vision encoders. Part of the IBM/Red Hat ecosystem.
- **Qwen3.6-27B** (`RedHatAI/Qwen3.6-27B-FP8`) — Scores 77.2% on SWE-bench Verified, supports native tool calling via `--tool-call-parser qwen3_coder`, and has 262K token native context. This is the highest-scoring open-source coding model that fits on a single GPU. Despite only being 27B parameters, it outperforms larger MoE models because dense models handle agentic coding workflows more reliably. `--language-model-only` disables the vision encoder to free VRAM for KV cache. `--reasoning-parser qwen3` strips internal `<think>` tags from output.

## Directory Layout

```
cluster-setup/      Cluster prerequisites (operators, RHOAI configuration)
  cluster-setup/operators/        Operator subscriptions (NFD, NVIDIA GPU, cert-manager, RHOAI)
  cluster-setup/ai-project/       Namespace, DataScienceCluster, and vLLM ServingRuntime
models/             Model storage, downloads, and InferenceServices (see models/README.md)
maas/               Models-as-a-Service setup with authentication and usage tracking (see maas/README.md)
litellm-litellm-gateway/    LiteLLM API translation layer (Anthropic ↔ OpenAI)
scripts/            Test scripts for models and MaaS API
alternatives/       Alternative approaches (direct vLLM without MaaS)
docs/               Documentation and blog posts
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

RHOAI v3 requires cert-manager. Install it first, then the GPU operators.

```bash
# cert-manager (required by RHOAI v3)
oc apply -f cluster-setup/operators/cert-manager.yaml
oc wait --for=condition=Available deployment -n cert-manager-operator --all --timeout=300s
```

### Step 3: Install GPU Operators

Install the GPU operators in order, waiting for each to be ready before proceeding.

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

> **Note on Service Mesh**: The RHOAI v3 docs list OpenShift Service Mesh as a dependency for KServe, but this appears to apply primarily to the deprecated Serverless/Knative mode. For RawDeployment mode (which this demo uses), Service Mesh should not be required. If you encounter issues with KServe not starting, try installing the Service Mesh operator as well.

### Step 5: Configure OpenShift AI

```bash
# Create the project namespace
oc apply -f cluster-setup/ai-project/namespace.yaml

# Deploy the DataScienceCluster (enables KServe)
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

### Step 6: Download and Deploy Models

First, create a HuggingFace token secret. Edit `models/hf-token-secret.yaml` and replace `REPLACE_WITH_YOUR_HF_TOKEN` with your actual token (this file is gitignored to prevent accidental credential leaks):

```bash
oc apply -f models/hf-token-secret.yaml
oc apply -f models/granite-pvc.yaml
oc apply -f models/qwen-pvc.yaml
oc apply -f models/granite-download-job.yaml
oc apply -f models/qwen-download-job.yaml
```

Monitor download progress:

```bash
# Granite (~30-45 minutes, BF16 weights are ~60GB)
oc logs -f job/download-granite-4-1-30b -n claude-code-demo

# Qwen (~20-30 minutes)
oc logs -f job/download-qwen3-6-27b -n claude-code-demo
```

Once downloads complete, deploy the Qwen chat template and InferenceServices:

```bash
# Qwen needs a custom chat template because the default rejects system
# messages mid-conversation (which Claude Code sends for tool context).
# Granite uses its built-in template and needs no override.
oc apply -f models/qwen-chat-template.yaml
oc apply -f models/granite-inference-service.yaml
oc apply -f models/qwen-inference-service.yaml
```

Wait for models to load:

```bash
oc get inferenceservice -n claude-code-demo -w
# Both should show READY=True after ~5 minutes
```

### Step 7: Deploy the LiteLLM Gateway

First, generate a strong API key and create the Secret. The gateway is exposed via a public Route, so this key protects it from unauthorised access:

```bash
# Generate a random API key
export LITELLM_KEY="sk-$(openssl rand -hex 24)"
echo "Your LiteLLM API key: $LITELLM_KEY"
echo "Save this — you'll need it for Claude Code configuration."

# Create the secret with the generated key
oc create secret generic litellm-api-key \
  --from-literal=master-key="$LITELLM_KEY" \
  -n claude-code-demo
```

Then deploy the gateway:

```bash
oc apply -f litellm-gateway/litellm-config.yaml
oc apply -f litellm-gateway/litellm-deployment.yaml
oc apply -f litellm-gateway/litellm-service.yaml
oc apply -f litellm-gateway/litellm-route.yaml
```

Wait for the gateway to be ready:

```bash
oc wait --for=condition=Available deployment/litellm-gateway -n claude-code-demo --timeout=120s
```

Get the gateway URL:

```bash
export GATEWAY_URL=$(oc get route litellm-gateway -n claude-code-demo -o jsonpath='{.spec.host}')
echo "Gateway URL: https://$GATEWAY_URL"
```

### Step 8: Test the Gateway

The first request to each model may fail or be slow while vLLM warms up. Send a quick warm-up request first, then test properly.

**Warm up both models (ignore errors on first attempt):**

```bash
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
    "model": "qwen3-6-27b",
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
- **Opus** → routes to Qwen3.6-27B on your cluster

The LiteLLM gateway maps Claude model names to local vLLM endpoints, so switching models in Claude Code transparently switches which open-source model handles your requests.

### Model Mapping

vLLM serves the models with their **real names** as primary identifiers, with Claude model names as aliases:

| Model you select | vLLM serves as | Routes to |
|------------------|----------------|-----------|
| `granite-4-1-30b` | `granite-4-1-30b` | IBM Granite 4.1 30B (30B params, FP8) |
| `qwen3-6-27b` | `qwen3-6-27b` | Qwen 3.6 27B FP8 (27B params, FP8) |
| `claude-sonnet-5` | `granite-4-1-30b` | Granite (alias via LiteLLM) |
| `claude-haiku-4-5-20251001` | `granite-4-1-30b` | Granite (alias via LiteLLM) |
| `claude-opus-5` | `qwen3-6-27b` | Qwen (alias via LiteLLM) |
| `claude-fable-5` | `qwen3-6-27b` | Qwen (alias via LiteLLM) |

**Recommendation:** Use the real model names (`granite-4-1-30b`, `qwen3-6-27b`) for clarity. The Claude aliases are provided for convenience when switching between local and Anthropic models.

You can modify `litellm-gateway/litellm-config.yaml` to change these mappings or add more models. The config uses the `hosted_vllm/` LiteLLM provider prefix for optimal vLLM compatibility, with `drop_params: true` to silently handle Anthropic-specific parameters that vLLM doesn't support.

### Using with Cursor

The same LiteLLM gateway serves an OpenAI-compatible API, so Cursor can connect directly without any translation layer.

In Cursor, go to **Settings → Models → OpenAI API** and configure:

- **Base URL**: `https://<gateway-url>/v1`
- **API Key**: your LiteLLM API key (same key used for Claude Code)
- **Model**: `granite-4-1-30b` or `qwen3-6-27b`

```bash
# Get your gateway URL
echo "https://$(oc get route litellm-gateway -n claude-code-demo -o jsonpath='{.spec.host}')/v1"
```

Cursor uses the OpenAI Chat Completions API (`/v1/chat/completions`) while Claude Code uses the Anthropic Messages API (`/v1/messages`) — both are served by the same gateway with the same authentication and usage tracking.

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
oc get inferenceservice -n claude-code-demo

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

- **Tool use**: File reading, editing, and bash commands may not work reliably — these require the model to emit correctly formatted tool calls. Qwen3.6 has native tool calling support via `qwen3_coder`; Granite 4.1 has native support via `granite4`
- **Web search**: Claude Code's built-in web search is a native Anthropic API feature and is not available with open-source models. Attempting it will produce an error
- **Extended thinking**: Not available with open-source models
- **Prompt caching**: Not available
- **Long context**: Granite is configured for 131K tokens, Qwen for 262K (vs Claude's 200K)
- **Multi-step reasoning**: Open-source models may struggle with complex, multi-tool workflows
- **First request latency**: vLLM compiles CUDA graphs on the first request after startup, causing 30-60 second delays. Subsequent requests are fast

## Alternative Approaches

### Models-as-a-Service (MaaS)

RHOAI 3.4+ includes a Models-as-a-Service feature that provides Red Hat-native API key authentication, per-user token quotas, and usage tracking via Kuadrant and Authorino. This is the **primary recommended setup**. See **[maas/README.md](maas/README.md)** for the full setup guide.

**⚠️ CRITICAL Known Issue (RHOAI 3.4.4):** The Kuadrant operator has a reconciliation loop bug that updates EnvoyFilters every second, causing Envoy hot restarts that drop active connections after 30-60 seconds. **Temporary workaround:** Scale down the Kuadrant operator after initial setup:

```bash
oc scale deployment/kuadrant-operator-controller-manager -n openshift-operators --replicas=0
```

This freezes MaaS policies but stops the connection drops. See **[docs/kuadrant-reconciliation-loop-bug.md](docs/kuadrant-reconciliation-loop-bug.md)** for full details and permanent solutions.

### Direct vLLM (No MaaS)

vLLM natively supports the Anthropic Messages API, so Claude Code can connect directly without MaaS authentication. This simplifies the architecture but loses usage tracking and multi-user support. See **[alternatives/direct-vllm/README.md](alternatives/direct-vllm/README.md)** for setup.

## Cleanup

```bash
# Remove InferenceServices, chat templates, and gateway
oc delete -f litellm-gateway/
oc delete -f models/granite-inference-service.yaml
oc delete -f models/qwen-inference-service.yaml
oc delete -f models/qwen-chat-template.yaml

# Remove download jobs and PVCs
oc delete -f models/granite-download-job.yaml
oc delete -f models/qwen-download-job.yaml
oc delete -f models/granite-pvc.yaml
oc delete -f models/qwen-pvc.yaml

# Remove AI project
oc delete -f cluster-setup/ai-project/serving-runtime.yaml
oc delete -f cluster-setup/ai-project/data-science-cluster.yaml
oc delete -f cluster-setup/ai-project/namespace.yaml

# Remove operators (optional — other workloads may depend on these)
oc delete -f cluster-setup/operators/nvidia-cluster-policy.yaml
oc delete -f cluster-setup/operators/nvidia-gpu-operator.yaml
oc delete -f cluster-setup/operators/nfd-instance.yaml
oc delete -f cluster-setup/operators/nfd.yaml
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

**Cause:** Kuadrant operator reconciliation loop bug (RHOAI 3.4.4) causes continuous Envoy hot restarts.

**Fix:** Scale down the Kuadrant operator:
```bash
oc scale deployment/kuadrant-operator-controller-manager -n openshift-operators --replicas=0
```

See **[docs/kuadrant-reconciliation-loop-bug.md](docs/kuadrant-reconciliation-loop-bug.md)** for complete details, verification steps, and permanent solutions.
