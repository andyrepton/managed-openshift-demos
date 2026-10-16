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

### 2. Check the configs

The devfile's postStart command installs everything and writes all three
configs, so there is nothing to copy by hand. Each points at the Devstral
service deployed by `demo-vllm-model-serving/`:

```
http://devstral-predictor.vllm-model-serving.svc.cluster.local:8000/v1
```

| Tool | Kind | Config |
|:---|:---|:---|
| OpenCode | terminal | `~/.config/opencode/opencode.jsonc` |
| Continue | extension | `~/.continue/config.json` |
| Kilo Code | extension | `~/.config/kilo/kilo.jsonc` |

```bash
grep -h baseURL ~/.config/opencode/opencode.jsonc ~/.config/kilo/kilo.jsonc
grep apiBase ~/.continue/config.json
```

The two extensions are installed by che-code from `DEFAULT_EXTENSIONS` at
editor startup, which takes a moment after the workspace opens. They total
about 210 MB of downloads, so the first start is slow.

### 3. Run them

OpenCode, from the terminal:

```bash
opencode                                   # interactive
opencode run "Reply with exactly: WORKING" # one-shot, useful for a smoke test
```

Continue and Kilo Code appear in the editor's left sidebar once installed.
Both are preconfigured against Devstral — no API key or sign-in needed, since
vLLM runs unauthenticated inside the cluster.

Kilo Code is the agentic one of the three: it sends a system prompt of around
16k tokens before you type anything, which is why the InferenceService runs
with `--max-model-len=24576` and Kilo's `limit.output` is 4096. At the 16384
the demo originally used, Kilo fails on its own system prompt:

```
This model's maximum context length is 16384 tokens. However, you requested
8192 output tokens and your prompt contains 16147 input tokens, for a total
of 24339 tokens.
```

24576 is close to the ceiling on a single A10G: the weights take 15.16 GiB of
the 24 GiB card, leaving 3.81 GiB of KV cache, and vLLM calculates the
maximum workable length as 24976. Going higher needs a larger GPU — the
engine refuses to start rather than degrading.

**The Kilo Code extension does not usefully fit on an A10G.** Its system
prompt is about 20,660 tokens — larger than the CLI's ~16,100 — which leaves
under 4,000 tokens for the reply and the entire conversation, and it hits
"Compaction exhausted" almost immediately. The CLI is usable; the extension
needs a bigger card. On a `g7e.2xlarge` (L40S, 48 GiB) there is room for a
65536 context and the extension behaves normally.

> **Config precedence trap.** Kilo reads legacy `opencode.json` files as well
> as its own, and a *project-level* config overrides the global one. An
> `opencode.json` in the repository root therefore silently overrides
> `~/.config/kilo/kilo.jsonc` — including its token limits. Keep OpenCode's
> config in `~/.config/opencode/` only.

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
