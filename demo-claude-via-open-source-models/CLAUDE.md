# Claude Code with Open Source Models on ROSA/ARO

## Project overview

This demo connects Claude Code to open-source LLMs running on OpenShift AI (ROSA and ARO) via vLLM, with a LiteLLM gateway that translates between Anthropic Messages API and OpenAI Chat Completions API. It demonstrates data protection, cost management, and model flexibility by letting users swap between a self-hosted open-source model and Anthropic's Claude with a single environment variable change.

## Architecture

```
Claude Code → LiteLLM Gateway (Anthropic→OpenAI translation) → MaaS Gateway → vLLM → Open Source Model
Cursor      → MaaS Gateway (OpenAI API, direct) → vLLM → Open Source Model
Claude Code → Anthropic API → Claude (when ANTHROPIC_BASE_URL is unset)
```

## Models

- **Granite 4.1 30B** (`ibm-granite/granite-4.1-30b`): IBM text-only coding model, 131K context, BF16 with on-the-fly FP8 quantisation, `--tool-call-parser granite4`
- **Qwen3.8-27B** (`Qwen/Qwen3.8-27B-INT4`): Best open-source coding model (SWE-bench Pro 61.7, DeepSWE 42.2), INT4 quantised, 262K context (YaRN to 1M), `--tool-call-parser qwen3_coder`, `--reasoning-parser qwen3`, `--language-model-only`

Both models are downloaded from HuggingFace to PVCs via Kubernetes Jobs, then served by vLLM through KServe InferenceServices.

## Key directories

- `operators/` — NFD, NVIDIA GPU Operator, cert-manager, and RHOAI operator installation YAMLs
- `ai-project/` — Namespace, DataScienceCluster, and vLLM ServingRuntime
- `models/` — PVCs, HuggingFace download Jobs, chat template ConfigMaps, and LLMInferenceServices for each model
- `gateway/` — LiteLLM proxy deployment (ConfigMap, Deployment, Service, Route)
- `native-vllm/` — Direct vLLM connection (no LiteLLM)
- `native-vllm/maas/` — Models-as-a-Service infrastructure (RHCL, Kuadrant, Authorino, PostgreSQL, MaaSAuthPolicy, MaaSSubscription). LLMInferenceService definitions are in `models/`. MaaS supports both OpenAI and Anthropic APIs — Cursor can connect directly, Claude Code can use LiteLLM or connect directly
- `docs/` — Blog post drafts and testing plan

## Cluster provisioning

Use `../andys-demo-cluster-tf` with `ai_rosa.tfvars` for ROSA. GPU machine pool needs `replicas: 2` for both models simultaneously (g7e.2xlarge with RTX PRO 6000, 96GB VRAM). For ARO, check the `aro/` module and ensure GPU quota is available.

## Namespace

All AI workloads run in the `claude-code-demo` namespace.

## Swapping models

**Between local models (no restart):** Use `/model` in Claude Code to switch:
- Sonnet/Haiku → Granite 4.1 30B
- Opus/Fable → Qwen3.6-27B

**Between local and Anthropic (requires restart):**
```bash
# Use open-source models on your cluster
export ANTHROPIC_BASE_URL="https://litellm-gateway-claude-code-demo.apps.<cluster-domain>"
export ANTHROPIC_API_KEY="<your-generated-litellm-key>"

# Switch back to Anthropic Claude
unset ANTHROPIC_BASE_URL
unset ANTHROPIC_API_KEY
```

## OpenShift AI version

This demo runs on **RHOAI 3.5**. Key details:
- DataScienceCluster API is `v2` (changed from `v1` in RHOAI v2)
- ModelMesh and Serverless deployment modes are deprecated — KServe RawDeployment is the standard
- vLLM image: `registry.redhat.io/rhaii/vllm-cuda-rhel9:3.5.0` (ships vLLM 0.24.0)
- llm-d is the default inference orchestration layer (uses vLLM underneath)
- Requires cert-manager operator as a prerequisite
- MaaS observability requires Cluster Observability Operator + Red Hat build of OpenTelemetry operator, plus `spec.monitoring.metrics.storage` configured in the DSCI

### vLLM version compatibility

RHOAI 3.5 ships vLLM v0.24.0 via `registry.redhat.io/rhaii/vllm-cuda-rhel9:3.5.0`. This satisfies Qwen3.6-27B's requirement of >= 0.19.0. Both models work correctly on vLLM 0.24.0.

## Gotchas discovered during setup

- **vLLM image registry**: RHOAI v3 moved from `rhoai` to `rhaii` registry namespace (`registry.redhat.io/rhaii/vllm-cuda-rhel9:3.5.0`)
- **Qwen system message rejection**: Qwen's default chat template rejects system messages that aren't first in the conversation. Claude Code sends system messages mid-conversation for tool context. Fixed with a custom chat template that allows system messages anywhere
- **Qwen thinking mode**: Qwen3.6 enables thinking/reasoning by default (`<think>` tags), which wastes tokens. Use `--reasoning-parser qwen3` to strip them — do NOT use `/no_think` in the template as it causes empty responses on Qwen3.6's hybrid Mamba/attention architecture
- **Qwen vision encoder**: Qwen3.6 is multimodal but we only need text. Use `--language-model-only` to disable the vision encoder and free VRAM for KV cache
- **Chat template tool format**: The custom Qwen chat template must use the native `<function=name><parameter=key>value</parameter></function>` format inside `<tool_call>` tags — NOT the Hermes-style JSON format. The `qwen3_coder` parser only recognises the native format. Our template is the model's built-in template with the system message restriction removed and `reasoning_effort` alias mapping added
- **Qwen 3.8 reasoning_effort mismatch**: Claude Code sends `reasoning_effort: "high"` but vLLM's Qwen3 parser only accepts `xhigh`, `medium`, and `low`. The custom chat template maps `high` → `medium` before validation ([QwenLM/Qwen3.8#217](https://github.com/QwenLM/Qwen3.8/issues/217)). Mapping to `xhigh` was avoided because it causes empty responses ~17% of the time (Qwen3.8#216). The template is backward-compatible with Qwen 3.6 (which doesn't use `reasoning_effort`)
- **DeepGemm on Blackwell**: vLLM 0.24 auto-disables DeepGemm in the APIServer but not the EngineCore, causing a crash (`Unknown recipe`). Set `VLLM_USE_DEEP_GEMM=0` in the ServingRuntime env vars
- **Granite FP8**: No pre-quantised RedHatAI FP8 variant available — use `ibm-granite/granite-4.1-30b` (BF16) with `--quantization fp8` for on-the-fly quantisation
- **LiteLLM provider prefix**: Use `hosted_vllm/` instead of `openai/` for the model prefix in LiteLLM config — it handles vLLM-specific behaviour better
- **LiteLLM drop_params**: Set `drop_params: true` to silently handle Anthropic-specific parameters (like extended thinking) that vLLM doesn't support
- **LiteLLM health probes**: The `/health` endpoint requires an API key when a master key is set. Use `/health/liveliness` for Kubernetes probes
- **Route timeout**: OpenShift Routes default to 30s timeout. Set `haproxy.router.openshift.io/timeout: 10m` for long-running model responses. Without this, Qwen's extended thinking responses get cut off mid-stream with `TransferEncodingError` or `ServerDisconnectedError` in LiteLLM logs
- **LiteLLM resources**: Under high load or concurrent long-running requests, LiteLLM needs at least 2Gi memory and 2 CPUs. Set `LITELLM_REQUEST_TIMEOUT=180` (enough for Qwen's worst-case TTFT with extended thinking) and `LITELLM_NUM_RETRIES=2` so transient failures retry in ~3 minutes instead of hanging for 10
- **MaaS gateway streaming timeouts**: When using LiteLLM → MaaS → vLLM (instead of LiteLLM → vLLM direct), the Istio/Envoy gateway has default stream idle timeouts (5 minutes) and payload processing timeouts (300s) that kill long-running responses. Apply `maas/stream-timeout-envoyfilter.yaml` and patch `payload-processing` EnvoyFilter to set all timeouts to `0s` (infinite). Without this, streaming responses >5 minutes fail with `TransferEncodingError: Not enough data to satisfy transfer length header`
- **Kuadrant reconciliation loop bug**: Fixed upstream in Kuadrant Operator v1.5.3 ([PR #2184](https://github.com/Kuadrant/kuadrant-operator/pull/2184)) — caused by non-deterministic `sort.Sort` ordering of WASM config. Root cause: Go's unstable sort produced different EnvoyFilter content each reconciliation cycle, triggering infinite updates and Envoy hot restarts. RHOAI 3.5 should include the fix. If still occurring, scale down the Kuadrant operator (`oc scale deployment/kuadrant-operator-controller-manager -n openshift-operators --replicas=0`). See `docs/kuadrant-reconciliation-loop-bug.md` for details
- **LLMInferenceService baseRefs**: Use `v3-4-4` baseRef names (e.g. `v3-4-4-kserve-config-llm-template-nvidia-cuda`) even on RHOAI 3.5. The RHOAI 3.5 operator auto-resolves them to v3-5-0 presets. Using `v3-5-0-kserve-config-llm-template-nvidia-cuda` directly causes `ConfigNotFound` errors despite the LLMInferenceServiceConfig existing on the cluster
- **GPU scheduling on updates**: When updating the ServingRuntime, KServe's default RollingUpdate strategy tries to create new pods before terminating old ones. With GPUs fully allocated, this deadlocks. Delete InferenceServices first, apply changes, then recreate
- **Model name mapping**: Claude Code sends many different model ID strings (claude-sonnet-5, claude-opus-5, claude-sonnet-4-20250514, etc.). All must be mapped in the LiteLLM config
- **MaaS DSC field migration**: In RHOAI 3.5, `spec.components.kserve.modelsAsService` is deprecated. Use `spec.components.aigateway.modelsAsAService` instead. The deprecated field still works but emits a warning on every apply
- **MaaS observability prerequisites**: The "Observe & monitor" dashboard in RHOAI requires three things: (1) Cluster Observability Operator installed, (2) Red Hat build of OpenTelemetry operator installed, (3) `spec.monitoring.metrics.storage` configured in the DSCI (not just `metrics: {}`). Without all three, `MonitoringStackAvailable` and `PersesAvailable` stay False and no dashboards appear. The Perses server, MonitoringStack, UIPlugin, and datasources are all auto-created by the RHOAI operator once prerequisites are met. Additionally, `MaasTenantConfig` must have `spec.telemetry.enabled: true` with `captureModelUsage: true` for usage dashboards to populate

## Important notes

- **Model names**: vLLM serves models with their real names (`granite-4-1-30b`, `qwen3-8-27b`) as primary identifiers. Claude model names (claude-sonnet-5, etc.) are aliases configured in both vLLM `--served-model-name` args and LiteLLM config
- **MaaS + Anthropic API**: MaaS **does** support the Anthropic Messages API format (not just OpenAI). Claude Code can connect directly to MaaS without LiteLLM, but LiteLLM provides convenient model name aliasing
- **Kuadrant bug**: Fixed upstream in Kuadrant v1.5.3, should be resolved in RHOAI 3.5. If still occurring, scale Kuadrant operator to 0 replicas (see gotchas above)
- **LiteLLM handles API translation** using the `hosted_vllm/` provider prefix when connecting to vLLM via MaaS
- **Tool use** (file reading, editing) may not work reliably with all open-source models — Qwen 3.8 and Granite 4.1 both have native tool calling support but quality varies
- **Extended thinking, prompt caching**, and other Claude-specific features are unavailable when using open-source models
- **First request** after vLLM startup is slow (30-60s) due to CUDA graph compilation — warm up models before demo
- **aiohttp timeout configuration**: LiteLLM deployment includes environment variables to disable socket read timeouts for long-running streaming responses
