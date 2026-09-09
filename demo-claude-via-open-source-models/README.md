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
oc logs -f job/download-qwen3-8-27b -n claude-code-demo
```

Once downloads complete, deploy the Qwen chat template and InferenceServices:

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

- **Tool use**: File reading, editing, and bash commands may not work reliably — these require the model to emit correctly formatted tool calls. Qwen3.8 has native tool calling support via `qwen3_coder`; Granite 4.1 has native support via `granite4`
- **Web search**: Claude Code's built-in web search is a native Anthropic API feature and is not available with open-source models. Attempting it will produce an error
- **Extended thinking**: Not available with open-source models
- **Prompt caching**: Not available
- **Long context**: Granite is configured for 131K tokens, Qwen for 262K (vs Claude's 200K)
- **Multi-step reasoning**: Open-source models may struggle with complex, multi-tool workflows
- **First request latency**: vLLM compiles CUDA graphs on the first request after startup, causing 30-60 second delays. Subsequent requests are fast

## Usage Monitoring (MaaS)

When using MaaS, RHOAI provides built-in Perses dashboards for monitoring token usage, authorized calls, and rate limiting per user and model. Setting this up requires three operator prerequisites and two configuration patches.

### Step 1: Install Operator Prerequisites

The observability stack requires the Cluster Observability Operator (COO) and the Red Hat build of OpenTelemetry:

```bash
oc apply -f cluster-setup/operators/cluster-observability-operator.yaml
oc apply -f cluster-setup/operators/opentelemetry.yaml
```

Wait for both to be ready:

```bash
oc get csv -n openshift-cluster-observability-operator | grep observability
oc get csv -n openshift-opentelemetry-operator | grep opentelemetry
# Both should show Phase: Succeeded
```

### Step 2: Configure Metrics in DSCI

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

### Step 3: Enable MaaS Telemetry

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

### Step 4: Enable the Dashboard UI

Enable the observability dashboard in the OpenShift AI console:

```bash
oc patch odhdashboardconfig odh-dashboard-config -n redhat-ods-applications \
  --type=merge -p '{"spec":{"dashboardConfig":{"observabilityDashboard":true}}}'
```

### Accessing the Dashboard

The MaaS usage dashboard is available in the OpenShift AI console at **Observe & monitor → Dashboard**. It shows:

- **Authorized calls** per model and user
- **Token usage** (input/output) per model
- **Rate-limited requests** when token quotas are exceeded
- **Request latency** breakdown

The dashboards are auto-managed Perses dashboards (`PersesDashboard` resources in `redhat-ods-monitoring`). There are no CLI or REST API endpoints for usage data — the dashboard is the only interface in RHOAI 3.5.

### MaaS Migration: kserve → aigateway

In RHOAI 3.5, `spec.components.kserve.modelsAsService` is deprecated. Migrate to `spec.components.aigateway.modelsAsAService`:

```bash
oc patch datasciencecluster default-dsc --type=merge -p '
spec:
  components:
    aigateway:
      modelsAsAService:
        managementState: Managed
'
```

Once the aigateway component is managing MaaS, clear the deprecated field:

```bash
oc patch datasciencecluster default-dsc --type=json -p '
[{"op": "remove", "path": "/spec/components/kserve/modelsAsService"}]
'
```

## Alternative Approaches

### Models-as-a-Service (MaaS)

RHOAI 3.5 includes a Models-as-a-Service feature that provides Red Hat-native API key authentication, per-user token quotas, and usage tracking via Kuadrant and Authorino. This is the **primary recommended setup**. See **[maas/README.md](maas/README.md)** for the full setup guide.

**Note:** RHOAI 3.4.x had a Kuadrant operator reconciliation loop bug that dropped connections every 30-60 seconds. This was fixed upstream in Kuadrant Operator v1.5.3 ([PR #2184](https://github.com/Kuadrant/kuadrant-operator/pull/2184)) and should be resolved in RHOAI 3.5. If still occurring, scale down the Kuadrant operator as a workaround — see **[docs/kuadrant-reconciliation-loop-bug.md](docs/kuadrant-reconciliation-loop-bug.md)** for details.

### Direct vLLM (No MaaS)

vLLM natively supports the Anthropic Messages API, so Claude Code can connect directly without MaaS authentication. This simplifies the architecture but loses usage tracking and multi-user support. See **[alternatives/direct-vllm/README.md](alternatives/direct-vllm/README.md)** for setup.

## Cleanup

```bash
# Remove LLMInferenceServices, chat templates, and gateway
oc delete -f litellm-gateway/
oc delete -f models/granite-llm-inference-service.yaml
oc delete -f models/qwen3-8-llm-inference-service.yaml
oc delete -f models/qwen-chat-template.yaml

# Remove download jobs and PVCs
oc delete -f models/granite-download-job.yaml
oc delete -f models/qwen3-8-download-job.yaml
oc delete -f models/granite-pvc.yaml
oc delete -f models/qwen3-8-pvc.yaml

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

**Cause:** Kuadrant operator reconciliation loop bug (fixed upstream in Kuadrant v1.5.3, should be resolved in RHOAI 3.5).

**Fix:** If still occurring on RHOAI 3.5, scale down the Kuadrant operator:
```bash
oc scale deployment/kuadrant-operator-controller-manager -n openshift-operators --replicas=0
```

See **[docs/kuadrant-reconciliation-loop-bug.md](docs/kuadrant-reconciliation-loop-bug.md)** for complete details, verification steps, and permanent solutions.
