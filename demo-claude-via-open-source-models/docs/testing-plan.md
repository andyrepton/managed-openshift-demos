# Testing Plan

## Part 1: Demo Validation

Verify end-to-end functionality before any live demo. Run through each section in order.

### 1.1 Infrastructure health

```bash
# GPU nodes ready
oc get nodes -l nvidia.com/gpu.present=true

# GPU operator healthy
oc get pods -n nvidia-gpu-operator | grep -v Completed

# Both models serving
oc get inferenceservice -n claude-code-demo
# Expect: both READY=True

# Gateway healthy
oc get pods -n claude-code-demo -l app=litellm-gateway
```

### 1.2 Gateway warm-up

Run these before any demo to avoid the slow first-request penalty:

```bash
export GATEWAY_URL=$(oc get route litellm-gateway -n claude-code-demo -o jsonpath='{.spec.host}')

# Warm up Granite
curl -s -X POST "https://$GATEWAY_URL/v1/messages" \
  -H "x-api-key: $LITELLM_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{"model": "claude-sonnet-4-20250514", "max_tokens": 16, "messages": [{"role": "user", "content": "Hi"}]}'

# Warm up Qwen
curl -s -X POST "https://$GATEWAY_URL/v1/messages" \
  -H "x-api-key: $LITELLM_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{"model": "claude-opus-4-20250514", "max_tokens": 16, "messages": [{"role": "user", "content": "Hi"}]}'
```

### 1.3 Claude Code basic connectivity

```bash
export ANTHROPIC_BASE_URL="https://$GATEWAY_URL"
export ANTHROPIC_API_KEY="$LITELLM_KEY"
claude
```

- [ ] `/status` shows the cluster route as base URL
- [ ] Simple prompt ("Hello") returns a response
- [ ] `/model` picker works — switch between Sonnet and Opus
- [ ] Both models respond after switching

### 1.4 Tool use validation

These test whether the models can use Claude Code's built-in tools.

**File reading** (most likely to work):
```
Read the README.md in this directory and tell me what this project does
```
- [ ] Granite (Sonnet): reads the file? Y/N
- [ ] Qwen (Opus): reads the file? Y/N

**File writing**:
```
Create a file called test-output.txt with "Hello from <model name>"
```
- [ ] Granite: creates the file? Y/N
- [ ] Qwen: creates the file? Y/N

**Bash execution**:
```
Run "oc version" and tell me which OpenShift version we're running
```
- [ ] Granite: runs the command? Y/N
- [ ] Qwen: runs the command? Y/N

**Multi-step tool use**:
```
List all YAML files in the models/ directory, then read the first one and summarise it
```
- [ ] Granite: completes multi-step? Y/N
- [ ] Qwen: completes multi-step? Y/N

### 1.5 Model swap demonstration

- [ ] Start Claude Code with `ANTHROPIC_BASE_URL` set (local models)
- [ ] Ask: "Write a Python function to check if a string is a palindrome"
- [ ] Record which model responded (check `/model`)
- [ ] Switch model with `/model`
- [ ] Ask the same question again
- [ ] Verify response comes from the other local model
- [ ] Exit Claude Code, `unset ANTHROPIC_BASE_URL`, relaunch
- [ ] Ask the same question — verify response comes from real Claude
- [ ] Note quality/speed difference

---

## Part 2: Model Comparison for Blog Content

Run each task across all three configurations. Record results in the table below each task.

### Configurations

| Config | Model | How to activate |
|--------|-------|----------------|
| A | Granite-Small-3.1-24B (local) | Set `ANTHROPIC_BASE_URL`, select Sonnet via `/model` |
| B | Qwen3.6-27B (local) | Set `ANTHROPIC_BASE_URL`, select Opus via `/model` |
| C | Anthropic Claude | Unset `ANTHROPIC_BASE_URL`, relaunch Claude Code |

### Task 1: Simple code generation

**Prompt**: "Write a Python function to find all prime numbers up to N using the Sieve of Eratosthenes"

| Config | Correct? | Response time | Code quality notes |
|--------|----------|--------------|-------------------|
| A (Granite) | | | |
| B (Qwen) | | | |
| C (Claude) | | | |

### Task 2: Code explanation

**Prompt**: "Read the file `gateway/litellm-config.yaml` and explain what it does"

| Config | Read file? | Explanation accurate? | Notes |
|--------|-----------|----------------------|-------|
| A (Granite) | | | |
| B (Qwen) | | | |
| C (Claude) | | | |

### Task 3: Bug fixing

Create `docs/buggy.py` with this content first:

```python
def binary_search(arr, target):
    left = 0
    right = len(arr)
    while left < right:
        mid = (left + right) / 2
        if arr[mid] == target:
            return mid
        elif arr[mid] < target:
            left = mid
        else:
            right = mid
    return -1
```

**Prompt**: "Read docs/buggy.py and find and fix all the bugs"

Expected bugs to find:
1. `/ 2` should be `// 2` (integer division)
2. `left = mid` should be `left = mid + 1` (infinite loop)
3. Off-by-one: could also flag `right = len(arr)` vs `len(arr) - 1` depending on convention

| Config | Bugs found | Correct fixes? | Used tool to edit? | Notes |
|--------|-----------|---------------|-------------------|-------|
| A (Granite) | /3 | | | |
| B (Qwen) | /3 | | | |
| C (Claude) | /3 | | | |

### Task 4: Refactoring

Create `docs/sync_example.py` first:

```python
import requests

def fetch_user(user_id):
    response = requests.get(f"https://api.example.com/users/{user_id}")
    return response.json()

def fetch_posts(user_id):
    response = requests.get(f"https://api.example.com/users/{user_id}/posts")
    return response.json()

def get_user_with_posts(user_id):
    user = fetch_user(user_id)
    posts = fetch_posts(user_id)
    user["posts"] = posts
    return user
```

**Prompt**: "Read docs/sync_example.py and refactor it to use async/await with aiohttp"

| Config | Correct async? | Used aiohttp? | Concurrent fetches? | Notes |
|--------|---------------|--------------|-------------------|-------|
| A (Granite) | | | | |
| B (Qwen) | | | | |
| C (Claude) | | | | |

### Task 5: Test generation

**Prompt**: "Write unit tests for the binary_search function in docs/buggy.py (assume the bugs are fixed)"

| Config | Tests run? | Edge cases covered? | Framework used? | Notes |
|--------|-----------|-------------------|----------------|-------|
| A (Granite) | | | | |
| B (Qwen) | | | | |
| C (Claude) | | | | |

### Task 6: Multi-step agentic workflow

**Prompt**: "Look at all the YAML files in the models/ directory. Create a summary table showing the model name, PVC size, GPU count, and max context length for each model."

This tests: file discovery, reading multiple files, extracting structured data, formatting output.

| Config | Files found? | Data accurate? | Formatted well? | Notes |
|--------|-------------|---------------|----------------|-------|
| A (Granite) | | | | |
| B (Qwen) | | | | |
| C (Claude) | | | | |

---

## Part 3: Results Summary

Fill this in after completing all tests.

### Tool Use Summary

| Capability | Granite | Qwen | Claude |
|-----------|---------|------|--------|
| File reading | | | Yes |
| File writing | | | Yes |
| Bash execution | | | Yes |
| Multi-step tools | | | Yes |
| Model switching | Yes | Yes | N/A |

### Quality Comparison

| Dimension | Granite | Qwen | Claude |
|-----------|---------|------|--------|
| Simple code gen | | | |
| Code explanation | | | |
| Bug finding | | | |
| Refactoring | | | |
| Test generation | | | |
| Agentic workflow | | | |
| Response speed | | | |

### Key Takeaways (for blog posts)

- Where open-source models matched Claude:
- Where open-source models fell short:
- Best use cases for local models:
- When to swap to Anthropic Claude:
- Data sovereignty value proposition:
- Cost comparison notes:
