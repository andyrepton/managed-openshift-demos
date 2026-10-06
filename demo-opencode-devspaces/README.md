# OpenCode AI Coding Assistant in Dev Spaces

Run [OpenCode](https://github.com/opencode-ai/opencode), an AI-powered coding assistant, inside OpenShift Dev Spaces — backed by a self-hosted Devstral model served via vLLM.

## Prerequisites

- `openshift-devspaces/` demo deployed (Dev Spaces operator + CheCluster)
- `demo-vllm-model-serving/` demo deployed (Devstral model serving via vLLM)

## Setup

### 1. Open a workspace

Get your Dev Spaces dashboard URL:

```bash
oc get checluster devspaces -n openshift-devspaces -o jsonpath='{.status.cheURL}'
```

Open the factory URL to launch a workspace with this devfile:

```
https://<devspaces-url>/f?url=https://github.com/andyrepton/managed-openshift-demos&devfilePath=demo-opencode-devspaces/devfile.yaml
```

### 2. Configure OpenCode

Once the workspace starts, OpenCode installs automatically via the postStart command. Copy the config file into place:

```bash
mkdir -p ~/.config/opencode
cp /projects/managed-openshift-demos/demo-opencode-devspaces/opencode.json ~/.config/opencode/config.json
```

### 3. Run OpenCode

```bash
opencode
```

OpenCode will connect to the in-cluster Devstral model and you can start coding with AI assistance.

## How it works

```
┌─────────────────────────────────────────────────┐
│  Dev Spaces Workspace                           │
│  ┌───────────┐     ┌─────────────────────────┐  │
│  │ OpenCode  │────▶│ vLLM (Devstral AWQ 4b)  │  │
│  │ (terminal)│     │ vllm-model-serving ns    │  │
│  └───────────┘     └─────────────────────────┘  │
│       ▲                      ▲                  │
│       │ OpenAI-compatible    │ GPU node          │
│       │ /v1/chat/completions │ (g5.4xlarge)      │
└───────┴──────────────────────┴──────────────────┘
```

- OpenCode runs in the Dev Spaces workspace container (no GPU needed)
- It calls the vLLM endpoint over the cluster network using the OpenAI-compatible API
- The model runs on a GPU node with the `nvidia.com/gpu` taint

## Verify

```bash
# Check the model is reachable from the workspace
curl -s http://devstral-predictor.vllm-model-serving.svc.cluster.local/v1/models

# Test a completion
curl -s http://devstral-predictor.vllm-model-serving.svc.cluster.local/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"devstral","messages":[{"role":"user","content":"Hello"}],"max_tokens":64}'
```

## Cleanup

Close the workspace from the Dev Spaces dashboard. No cluster resources to clean up beyond the workspace itself — the model serving and Dev Spaces infrastructure are managed by their respective demos.
