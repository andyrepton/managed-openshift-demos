# Tuning OpenShift Lightspeed for Better Tool Calling

Lightspeed's out-of-the-box config works for basic Q&A, but tool calling (MCP tools, Kubernetes API queries) often underperforms. This demo shows how to tune the OLSConfig operand to improve it.

## Why Tool Calls Fail

Common causes of poor tool calling in Lightspeed:

1. **Token budget too small** (`maxTokensForResponse: 2048`) — tool call JSON gets truncated mid-output, producing malformed calls. Bump to 4096+.
2. **Tool filtering too aggressive** — the default `toolFilteringConfig` may exclude relevant tools before the model sees them. Lowering `threshold` and `alpha` while raising `topK` gives the model more tools to choose from.
3. **System prompt doesn't guide tool use** — the default prompt doesn't instruct the model to prefer tools over memorized answers. A custom `querySystemPrompt` that explicitly says "use tools for live cluster state" makes a big difference.
4. **Low iteration limit** (`maxIterations: 5`) — complex queries need chained tool calls (list -> get -> describe). 5 iterations isn't always enough.
5. **Short timeouts** — `mcpKubeServerConfig.timeout` defaults to 60s, `mcpServers[].timeout` defaults to 5s. Large list operations or slow clusters can hit these.
6. **Tool budget ratio** (`toolBudgetRatio: 0.5`) — controls what fraction of context is allocated to tool schemas. If you have many tools, lowering this leaves more room for conversation history. If you have few tools, 0.3 is fine.

## Tunable Fields

| Field | Default | Tuned | Why |
|-------|---------|-------|-----|
| `parameters.maxTokensForResponse` | 2048 | 4096 | Prevents truncated tool call JSON |
| `parameters.toolBudgetRatio` | 0.5 | 0.3 | Frees context for history when tool count is low |
| `ols.maxIterations` | 5 | 10 | Allows longer tool call chains |
| `toolFilteringConfig.alpha` | 0.8 | 0.6 | Less aggressive hybrid filtering |
| `toolFilteringConfig.topK` | 10 | 15 | More candidate tools surfaced |
| `toolFilteringConfig.threshold` | 0.01 | 0.005 | Lower cutoff keeps marginal tools in |
| `mcpKubeServerConfig.timeout` | 60s | 120s | Handles slow API responses |
| `ols.querySystemPrompt` | (default) | (custom) | Explicitly guides tool usage |

## Prerequisites

This demo assumes the LLM is served by OpenShift AI (RHOAI) with vLLM, potentially on a different cluster. You need:

- The RHOAI model serving inference endpoint URL
- An API token for the inference endpoint
- A model with good tool calling support (e.g. Granite, Llama 3.1+, Mistral)

## Setup

```bash
# Install the operator
oc apply -f operator.yaml

# Wait for CSV
oc get csv -n openshift-lightspeed -w

# Create credentials — set the apitoken to your RHOAI inference endpoint token
oc apply -f credentials-secret.yaml

# Edit olsconfig-tuned.yaml:
#   - Set provider url to your RHOAI inference endpoint
#   - Set model name to match the deployed model
#   - Adjust contextWindowSize to match your model's context length
oc apply -f olsconfig-tuned.yaml
```

A minimal default config is also provided in `olsconfig-default.yaml` for comparison.

## Files

- `operator.yaml` — Namespace, operator group, and subscription
- `credentials-secret.yaml` — MaaS / RHOAI inference endpoint token (replace REPLACE_ME)
- `olsconfig-default.yaml` — Minimal baseline config with defaults
- `olsconfig-tuned.yaml` — Tuned config with improved tool calling
- `olsconfig-with-mcp-server.yaml` — Tuned config with external MCP server examples
- `mcp-server-secret.yaml` — Credentials for external MCP servers (replace REPLACE_ME)
- `kustomization.yaml` — Kustomize overlay using tuned config

## Switching Between Configs

```bash
# Compare default vs tuned
diff olsconfig-default.yaml olsconfig-tuned.yaml

# Apply default (baseline)
oc apply -f olsconfig-default.yaml

# Apply tuned (better tool calling)
oc apply -f olsconfig-tuned.yaml

# Apply tuned with external MCP servers
oc apply -f mcp-server-secret.yaml
oc apply -f olsconfig-with-mcp-server.yaml
```

## Provider Types

The `type` field on the provider supports: `azure_openai`, `openai`, `watsonx`, `bam`, `rhoai_vllm`, `rhelai_vllm`, `bedrock`, `google_vertex`, `google_vertex_anthropic`, `fake_provider`.

The configs in this demo use `openai` because the LLM is served by RHOAI MaaS on a separate cluster — MaaS exposes a standard OpenAI-compatible API, so `openai` is the correct type. If the RHOAI endpoint is on the **same cluster**, use `rhoai_vllm` instead — it handles internal cluster TLS and service discovery natively.

## External MCP Servers

Lightspeed's built-in introspection MCP server gives it access to the Kubernetes API. External MCP servers extend this with tools for other systems — monitoring, ticketing, CI/CD, databases, etc.

MCP servers communicate over HTTP+SSE (Server-Sent Events). Lightspeed discovers the server's available tools at startup and offers them to the LLM alongside the built-in tools.

### How it works

1. You deploy an MCP server (any language/framework that speaks the [MCP protocol](https://modelcontextprotocol.io)) and expose it via a Route or Service
2. You add it to the `spec.mcpServers` array in the OLSConfig with its URL and auth headers
3. Lightspeed connects to the `/sse` endpoint, discovers the tool list, and makes them available to the LLM
4. When the LLM decides to call an external tool, Lightspeed proxies the request to the MCP server

### Authentication modes

There are three ways to authenticate with external MCP servers:

| Mode | `valueFrom.type` | Use case |
|------|------------------|----------|
| **Secret** | `secret` | Static API key or token stored in a Kubernetes Secret |
| **Kubernetes** | `kubernetes` | Service account token for in-cluster MCP servers |
| **Client passthrough** | `client` | Forwards the end user's OpenShift token to the MCP server |

Secret-based auth is the simplest — create a Secret with the token and reference it:

```yaml
mcpServers:
  - name: my-tools
    url: https://my-mcp-server.example.com/sse
    timeout: 30
    headers:
      - name: Authorization
        valueFrom:
          type: secret
          secretRef:
            name: external-mcp-credentials
```

Client passthrough is useful when the MCP server needs to act as the user (e.g. checking their RBAC permissions before returning data).

See `olsconfig-with-mcp-server.yaml` for all three patterns.

### Timeouts

Each MCP server has its own `timeout` (default 5s). This is separate from `mcpKubeServerConfig.timeout` (default 60s) which controls the built-in Kubernetes MCP server. External servers that query slow backends (Prometheus range queries, database queries) need higher timeouts.

### Tool filtering with many MCP tools

When you add external MCP servers, the total number of available tools can grow significantly. Enable the `ToolFiltering` feature gate and tune `toolFilteringConfig` to prevent the model from being overwhelmed:

```yaml
featureGates:
  - name: MCPServer
  - name: ToolFiltering
```

Without tool filtering, all tools are sent to the model on every query, which can exhaust the context window and degrade tool selection quality.

## Notes

- **`querySystemPrompt`** is the single biggest lever for tool calling quality. The model follows the system prompt instructions on when and how to use tools.
- **`introspectionEnabled`** (default true) enables the built-in OpenShift MCP server. Without it, Lightspeed has no tools to call. Requires the `MCPServer` feature gate.
- **`toolBudgetRatio`** is a tradeoff: higher = more tool schemas in context = less room for conversation history. With few tools (< 10), 0.3 is fine.
- **`maxIterations`** controls how many agentic loop steps the model can take. Each tool call + response is one iteration. Set higher for complex multi-step queries.
- **`toolFilteringConfig`** uses hybrid RAG to pre-filter which tools the model sees. If the model isn't calling a tool you expect, these thresholds may be filtering it out. Requires the `ToolFiltering` feature gate.
- **`mcpKubeServerConfig.timeout`** (default 60s) — increase if the cluster API is slow or you're listing many resources.
