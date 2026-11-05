# vLLM Model Serving with Devstral

This demo serves Mistral's [Devstral Small 2
24B](https://huggingface.co/mistralai/Devstral-Small-2-24B-Instruct-2512) coding
model with vLLM on Red Hat OpenShift AI, in its 4-bit AWQ form that fits on a
single 24 GB A10G GPU. A Job downloads the weights to a persistent volume and
KServe serves them as an OpenAI-compatible API inside the cluster, which other
workloads, such as coding assistants in OpenShift Dev Spaces, can then use. It
is here to show OpenShift AI hosting open-weight models on GPU nodes in a
managed cluster; other demos build on it. It needs the `openshift-ai` base demo.

Tested: 2026-11-04, ROSA HCP 4.22.12, RHOAI 3.5.2, on a g7e.2xlarge GPU.

Devstral is Mistral's agentic coding model: 68% SWE-bench Verified, Apache 2.0, with native tool-calling support. The AWQ 4-bit quantized variant fits on a single A10G (24GB) GPU.

## Prerequisites

- [`openshift-ai/`](../openshift-ai/) demo deployed (NFD, NVIDIA GPU Operator, RHOAI)
- GPU node available with `nvidia.com/gpu` taint
- A HuggingFace token
- `jq`, for reading the test responses

## Setup

### 1. Create namespace and HF token secret

```bash
oc apply -f namespace.yaml
read -rs HF_TOKEN                   # paste your HuggingFace token, then Enter
printf '%s' "$HF_TOKEN" | oc create secret generic hf-token \
  -n vllm-model-serving --from-file=token=/dev/stdin
unset HF_TOKEN
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
# Wait on the InferenceService, not its pod: the pod does not exist yet
oc wait --for=condition=Ready inferenceservice/devstral -n vllm-model-serving --timeout=15m
```

## Verify

```bash
# Test from inside the model's own pod (it has curl)
oc exec -n vllm-model-serving deploy/devstral-predictor -c kserve-container -- \
  curl -s http://localhost:8000/v1/models | jq -r '.data[].id'
# devstral

# Test chat completion
oc exec -n vllm-model-serving deploy/devstral-predictor -c kserve-container -- \
  curl -s http://localhost:8000/v1/chat/completions -H "Content-Type: application/json" \
  -d '{"model":"devstral","messages":[{"role":"user","content":"Write a Python function to reverse a linked list"}],"max_tokens":512}' \
  | jq -r '.choices[0].message.content'
```

## In-cluster endpoint

Other services (e.g. OpenCode in Dev Spaces) can reach the model at:

```
http://devstral-predictor.vllm-model-serving.svc.cluster.local:8000/v1
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
