# Stage Demo Script (4 minutes)

## Pre-demo setup (do this 2 min before going on stage)

```bash
cd stage-demo/

# Set up the connection
export ANTHROPIC_BASE_URL="https://$(oc get route litellm-gateway -n claude-code-demo -o jsonpath='{.spec.host}')"
export ANTHROPIC_API_KEY="$LITELLM_KEY"

# Warm up the model (first request compiles CUDA graphs)
curl -s -X POST "${ANTHROPIC_BASE_URL}/v1/messages" \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{"model": "claude-opus-4-20250514", "max_tokens": 16, "messages": [{"role": "user", "content": "Hi"}]}'

# Reset app.py to the buggy version (git checkout if needed)
```

## On stage

### 1. Intro + Connection proof (~30s)

Launch Claude Code:
```bash
claude --model claude-opus-4-20250514
```

Show it's connected to the cluster:
```
/status
```

Point out the Anthropic base URL — "This is hitting our own cluster, not the Anthropic API."

### 2. Code generation from CSV (~60s)

> Read data.csv and write a Python script that loads it and prints a summary: total sales per region and who the top performer is

This shows: file reading (tool use) + code generation. The CSV is tiny so the response is fast.

### 3. Bug fix (~60s)

> There's a bug in app.py — the GET /products/{id} endpoint doesn't return the first product. Find and fix it

The bug: `range(1, len(products))` skips index 0. The model should spot it, explain it, and fix it with the Edit tool.

### 4. Add a feature via README (~60s)

> Read the README and add a health check endpoint to app.py that returns the total product count and whether the service is up

Shows: reads one file to understand context, edits another file. Demonstrates the agentic loop.

### 5. The switchover (~30s)

Exit Claude Code, then:
```bash
unset ANTHROPIC_BASE_URL
claude
```

> "One environment variable change — now I'm on the real Anthropic API. Same tool, same workflow. When data sensitivity matters, point it at your cluster. When you need maximum quality, point it at Anthropic. Your team doesn't need to change anything."

## The bugs in app.py

Two planted issues for the model to find:

1. **Off-by-one in get_product()** — `range(1, len(products))` skips index 0, so product ID 1 (Laptop) is never returned. Fix: `range(len(products))` or use a list comprehension.

2. **Route ordering** — `/products/low-stock` and `/products/total-value` are defined AFTER `/products/{product_id}`, so FastAPI matches them as product_id="low-stock". Fix: move them above the parameterised route. (The model may or may not catch this one — bonus points if it does.)

## Talking points while waiting for responses

- "The model weights never leave our infrastructure — no code, no prompts sent externally"
- "This is a 27 billion parameter model running on a single GPU inside OpenShift"
- "We're using Red Hat OpenShift AI's Models-as-a-Service for auth and token tracking"
- "Any open-source model works here — swap Qwen for Llama, Granite, DeepSeek, whatever your team prefers"
