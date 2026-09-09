# Model Management

This directory contains model downloads, storage, and InferenceService configurations.

## Current Models

| Model | Size | Use Case | Context Length | Quantization |
|-------|------|----------|----------------|--------------|
| IBM Granite 4.1 30B | 30B params | General coding, fast responses | 131K tokens | FP8 (on-the-fly) |
| Qwen 3.6 27B | 27B params | Complex coding, SWE-bench 77.2% | 262K tokens | FP8 (pre-quantized) |
| Qwen 3.8 27B | 27B params | Complex coding, SWE-bench Pro 61.7, DeepSWE 42.2 | 262K tokens (native, YaRN to 1M) | INT4 (compressed-tensors, ~19.5GB) |

## Directory Structure

```
models/
├── README.md                            # This file
├── hf-token-secret.yaml                 # HuggingFace token for gated models
├── granite-pvc.yaml                     # Storage for Granite model
├── granite-download-job.yaml            # HuggingFace download job
├── granite-llm-inference-service.yaml   # LLMInferenceService (MaaS)
├── qwen-pvc.yaml                        # Storage for Qwen model
├── qwen-download-job.yaml               # HuggingFace download job
├── qwen-chat-template.yaml              # Custom chat template ConfigMap
└── qwen-llm-inference-service.yaml      # LLMInferenceService (MaaS)
```

## Deploying Models

These `LLMInferenceService` resources deploy models via the MaaS gateway, which provides API key auth, rate limiting, and usage tracking. Requires the MaaS stack from `maas/`.

```bash
oc apply -f granite-llm-inference-service.yaml
oc apply -f qwen-llm-inference-service.yaml
```

For a simpler setup without MaaS (no auth or usage tracking), see `alternatives/direct-vllm/` which has plain KServe `InferenceService` resources.

## Adding a New Model

Follow these steps to add a new model to your cluster:

### 1. Create a PVC for Model Storage

Create a PersistentVolumeClaim sized appropriately for your model. FP8-quantized models typically need:
- **7B models**: 10-15GB
- **13B models**: 20-30GB
- **27-30B models**: 40-60GB
- **70B+ models**: 80-150GB

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: <model-name>-model-storage
  namespace: claude-code-demo
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 50Gi  # Adjust based on model size
  storageClassName: gp3-csi  # Or your cluster's storage class
```

### 2. Create a Download Job

Download the model from HuggingFace using a Kubernetes Job. Replace `<model-name>` and `<huggingface-model-id>`:

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: download-<model-name>
  namespace: claude-code-demo
spec:
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: download
          image: python:3.11-slim
          command:
            - /bin/bash
            - -c
            - |
              pip install -q huggingface_hub
              python3 -c "
              from huggingface_hub import snapshot_download
              snapshot_download(
                  repo_id='<org>/<model-name>',
                  local_dir='/mnt/models/<model-name>',
                  token='$(cat /etc/hf-token/token)'
              )
              "
          volumeMounts:
            - name: model-storage
              mountPath: /mnt/models
            - name: hf-token
              mountPath: /etc/hf-token
              readOnly: true
      volumes:
        - name: model-storage
          persistentVolumeClaim:
            claimName: <model-name>-model-storage
        - name: hf-token
          secret:
            secretName: hf-token
```

**Monitor the download:**
```bash
oc logs -f job/download-<model-name> -n claude-code-demo
```

### 3. (Optional) Create a Custom Chat Template

Some models require custom chat templates to work correctly with Claude Code. For example, Qwen's default template rejects system messages mid-conversation.

If needed, create a ConfigMap with your template:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: <model-name>-chat-template
  namespace: claude-code-demo
data:
  chat_template.jinja: |
    # Your Jinja2 chat template here
    # See qwen-chat-template.yaml for an example
```

### 4. Create an InferenceService

Deploy the model using KServe's InferenceService API:

```yaml
apiVersion: serving.kserve.io/v1beta1
kind: InferenceService
metadata:
  name: <model-name>
  namespace: claude-code-demo
  annotations:
    serving.kserve.io/deploymentMode: RawDeployment
    openshift.io/display-name: "<Model Display Name>"
  labels:
    opendatahub.io/dashboard: "true"
spec:
  predictor:
    minReplicas: 1
    maxReplicas: 1
    model:
      modelFormat:
        name: vLLM
      name: ""
      runtime: vllm-cuda-runtime
      storageUri: pvc://<model-name>-model-storage/<model-name>
      args:
        - --max-model-len=<context-length>  # e.g. 131072
        - --enable-auto-tool-choice
        - --tool-call-parser=<parser>       # e.g. hermes, granite4, qwen3_coder
        # Add quantization if needed:
        # - --quantization=fp8
        # Add reasoning parser if supported:
        # - --reasoning-parser=qwen3
        # Add chat template if using custom ConfigMap:
        # - --chat-template=/etc/chat-template/<model>/chat_template.jinja
      env:
        - name: VLLM_USE_DEEP_GEMM
          value: "0"  # Disable DeepGemm (Blackwell GPU bug workaround)
      resources:
        limits:
          cpu: "4"
          memory: 16Gi
          nvidia.com/gpu: "1"
        requests:
          cpu: "2"
          memory: 8Gi
          nvidia.com/gpu: "1"
      # If using custom chat template:
      # volumeMounts:
      #   - name: chat-template
      #     mountPath: /etc/chat-template/<model>
      #     readOnly: true
    tolerations:
      - effect: NoSchedule
        key: nvidia.com/gpu
        operator: Exists
    # If using custom chat template:
    # volumes:
    #   - name: chat-template
    #     configMap:
    #       name: <model-name>-chat-template
```

### 5. Configure LiteLLM Gateway

Add your model to the LiteLLM gateway configuration in `litellm-gateway/litellm-config.yaml`:

```yaml
- model_name: "your-model-alias"
  litellm_params:
    model: hosted_vllm/<model-name>
    api_base: http://<model-name>-predictor.claude-code-demo.svc.cluster.local:8080/v1
    api_key: "not-needed"
    drop_params: true
```

Apply the updated config:
```bash
oc apply -f litellm-gateway/litellm-config.yaml
oc rollout restart deployment litellm-gateway -n claude-code-demo
```

### 6. Wait for Model to Load

```bash
oc get inferenceservice <model-name> -n claude-code-demo -w
# Wait for READY=True (takes 3-5 minutes)
```

### 7. Test the Model

```bash
# Get the gateway URL
export GATEWAY_URL=$(oc get route litellm-gateway -n claude-code-demo -o jsonpath='{.spec.host}')
export LITELLM_KEY=$(oc get secret litellm-api-key -n claude-code-demo -o jsonpath='{.data.master-key}' | base64 -d)

# Test request
curl -s -X POST "https://$GATEWAY_URL/v1/messages" \
  -H "x-api-key: $LITELLM_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "your-model-alias",
    "max_tokens": 256,
    "messages": [{"role": "user", "content": "Write a Python hello world"}]
  }' | python3 -m json.tool
```

## Model Selection Guide

### For General Coding (like Granite)
Look for models with:
- Strong code completion benchmarks (HumanEval, MBPP)
- Native tool calling support
- 100K+ context window
- FP8 quantization available

**Recommended:**
- IBM Granite series
- DeepSeek Coder series
- Qwen Coder series

### For Complex Reasoning (like Qwen)
Look for models with:
- High SWE-bench Verified scores (>70%)
- Multi-step reasoning capabilities
- Strong tool-use performance
- Long context support (200K+)

**Recommended:**
- Qwen 2.5/3.6 Coder series
- DeepSeek V3 series
- Llama 3.3 70B+ (if you have multi-GPU)

### For Fast Autocomplete (Future: 7B-13B models)
Look for models with:
- Sub-second latency on single GPU
- Good code completion (not necessarily reasoning)
- Small memory footprint (fits with other models)

**Recommended:**
- DeepSeek Coder 6.7B
- CodeLlama 7B/13B
- StarCoder2 7B/15B

## Useful vLLM Arguments

| Argument | Purpose | Example |
|----------|---------|---------|
| `--max-model-len` | Context window size | `131072` (128K) |
| `--quantization` | Enable quantization | `fp8`, `awq`, `gptq` |
| `--tool-call-parser` | Tool calling format | `granite4`, `qwen3_coder`, `hermes` |
| `--reasoning-parser` | Enable thinking/CoT | `qwen3` |
| `--language-model-only` | Disable vision encoder | (flag only, no value) |
| `--chat-template` | Custom template path | `/etc/chat-template/model/template.jinja` |
| `--tensor-parallel-size` | Multi-GPU serving | `2`, `4`, `8` |

## Troubleshooting

### Model Download Fails
```bash
# Check job logs
oc logs job/download-<model-name> -n claude-code-demo

# Common issues:
# - Invalid HuggingFace token
# - Model is gated (requires acceptance of terms)
# - Insufficient storage in PVC
```

### Model Pod Crashes (OOM)
```bash
# Check pod logs
oc logs <model-name>-predictor-xxx -n claude-code-demo

# Fixes:
# - Reduce --max-model-len
# - Use stronger quantization (FP8 instead of BF16)
# - Use larger GPU instance type
# - Enable --tensor-parallel-size for multi-GPU
```

### First Request Takes 30-60 Seconds
This is normal. vLLM compiles CUDA graphs on first request. Subsequent requests will be fast.

### Tool Calls Don't Work
Check your `--tool-call-parser` matches your model:
- Granite models: `granite4`
- Qwen models: `qwen3_coder`
- Hermes/OpenHermes: `hermes`
- Mistral: `mistral`

See vLLM docs for full parser list: https://docs.vllm.ai/en/latest/

## Resources

- [vLLM Supported Models](https://docs.vllm.ai/en/latest/models/supported_models.html)
- [HuggingFace Models](https://huggingface.co/models)
- [OpenLLM Leaderboard](https://huggingface.co/spaces/open-llm-leaderboard/open_llm_leaderboard)
- [BigCode Models Leaderboard](https://huggingface.co/spaces/bigcode/bigcode-models-leaderboard)
