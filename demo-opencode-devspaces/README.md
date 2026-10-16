# OpenCode AI Coding Assistant in Dev Spaces

Run [OpenCode](https://github.com/opencode-ai/opencode), an AI-powered coding assistant, inside OpenShift Dev Spaces — backed by a self-hosted Devstral model served via vLLM.

## Prerequisites

Deploy these in order — each one depends on the one above it:

1. [`openshift-ai/`](../openshift-ai/) — NFD, NVIDIA GPU Operator and RHOAI.
   Needs a GPU machine pool (`deploy_ai_machine_pool = true` in terraform).
2. [`demo-vllm-model-serving/`](../demo-vllm-model-serving/) — Devstral served
   by vLLM. Needs `$HUGGING_FACE_HUB_TOKEN`.
3. [`openshift-devspaces/`](../openshift-devspaces/) — Dev Spaces operator and
   CheCluster.

On AWS, pick a GPU instance type your region actually offers in the subnet
terraform selects: `g5.4xlarge` is absent from `eu-west-2c`, and the machine
pool API rejects the pool outright rather than falling back to another zone.

## Setup

### 1. Open a workspace

Get your Dev Spaces dashboard URL. The CheCluster lives in
`openshift-operators`, not `openshift-devspaces`:

```bash
oc get checluster devspaces -n openshift-operators -o jsonpath='{.status.cheURL}'
```

Open the factory URL to launch a workspace with this devfile. Dev Spaces takes
the repository after a `#` fragment, with parameters appended to it — a
`/f?url=` query string does not work:

```
https://<devspaces-url>#https://github.com/andyrepton/managed-openshift-demos?devfilePath=demo-opencode-devspaces/devfile.yaml
```

### 2. Check the OpenCode config

The devfile's postStart command installs OpenCode and writes the config for
you, so there is nothing to copy by hand. Confirm it landed:

```bash
cat ~/.config/opencode/opencode.jsonc
```

It should point at the Devstral service deployed by
`demo-vllm-model-serving/`:

```
http://devstral-predictor.vllm-model-serving.svc.cluster.local/v1
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

KServe creates `devstral-predictor` as a **headless** service, so its DNS name
resolves straight to the pod and the service's 80 → 8000 port mapping never
applies. Address port 8000 explicitly; port 80 just times out.

```bash
# Check the model is reachable from the workspace
curl -s http://devstral-predictor.vllm-model-serving.svc.cluster.local:8000/v1/models

# Test a completion
curl -s http://devstral-predictor.vllm-model-serving.svc.cluster.local:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"devstral","messages":[{"role":"user","content":"Hello"}],"max_tokens":64}'
```

Then from the workspace terminal, non-interactively:

```bash
opencode run "Reply with exactly the word: WORKING"
```

## Cleanup

Close the workspace from the Dev Spaces dashboard. No cluster resources to clean up beyond the workspace itself — the model serving and Dev Spaces infrastructure are managed by their respective demos.
