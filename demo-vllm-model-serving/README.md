# vLLM Model Serving with Devstral

Serve [Devstral Small 2 24B](https://huggingface.co/mistralai/Devstral-Small-2-24B-Instruct-2512) (AWQ 4-bit) via vLLM on OpenShift AI, exposing an OpenAI-compatible API.

Devstral is Mistral's agentic coding model — 68% SWE-bench Verified, Apache 2.0, with native tool-calling support. The AWQ 4-bit quantized variant fits on a single A10G (24GB) GPU.

## Prerequisites

- [`openshift-ai/`](../openshift-ai/) demo deployed (NFD, NVIDIA GPU Operator, RHOAI)
- GPU node available with `nvidia.com/gpu` taint
- HuggingFace token (from `source ~/.secrets/tf-setup.sh`)

## Setup

### 1. Create namespace and HF token secret

```bash
oc apply -f namespace.yaml
oc create secret generic hf-token \
  --from-literal=token="$HUGGING_FACE_HUB_TOKEN" \
  -n vllm-model-serving
```

### 2. Download model weights

The download job runs on the GPU node so the PVC is created in the same AZ:

```bash
oc apply -f model-pvc.yaml
oc apply -f model-download-job.yaml
oc wait --for=condition=complete job/download-devstral -n vllm-model-serving --timeout=30m
```

### 3. Deploy the model

```bash
oc apply -f serving-runtime.yaml
oc apply -f inference-service.yaml
```

Wait for the predictor pod to become ready (takes 2-3 minutes to load weights):

```bash
oc wait --for=condition=Ready pod -l serving.kserve.io/inferenceservice=devstral -n vllm-model-serving --timeout=10m
```

## Verify

```bash
# Test from inside the cluster
POD_IP=$(oc get pod -n vllm-model-serving -l serving.kserve.io/inferenceservice=devstral -o jsonpath='{.items[0].status.podIP}')

# List models
oc run curl-test --rm -i --restart=Never -n vllm-model-serving --image=curlimages/curl -- \
  curl -s "http://${POD_IP}:8000/v1/models"

# Test chat completion
oc run curl-chat --rm -i --restart=Never -n vllm-model-serving --image=curlimages/curl -- \
  curl -s "http://${POD_IP}:8000/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{"model":"devstral","messages":[{"role":"user","content":"Write a Python function to reverse a linked list"}],"max_tokens":512}'
```

## In-cluster endpoint

Other services (e.g. OpenCode in Dev Spaces) can reach the model at:

```
http://devstral-predictor.vllm-model-serving.svc.cluster.local:80/v1
```

Model name: `devstral`

## Cleanup

```bash
oc delete -f inference-service.yaml
oc delete -f serving-runtime.yaml
oc delete job download-devstral -n vllm-model-serving
oc delete -f model-pvc.yaml
oc delete secret hf-token -n vllm-model-serving
oc delete -f namespace.yaml
```
