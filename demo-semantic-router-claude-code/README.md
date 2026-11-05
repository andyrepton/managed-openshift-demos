# Claude Code with vLLM Semantic Router on OpenShift AI

This demo lets developers use Claude Code without picking a model. Every
request goes to one model name, and
[vLLM Semantic Router](https://github.com/vllm-project/semantic-router) (vSR)
decides where it should run: everyday coding goes to an open-source model on
your own OpenShift AI GPUs, and only hard reasoning goes to a paid frontier
model. That cuts token costs and keeps most work on infrastructure you control,
while every request is still authenticated, rate limited and metered by
OpenShift AI Models-as-a-Service (MaaS). It is here to show OpenShift AI acting
as the control point between AI coding tools and many models, building on the
[Claude Code with open-source models](../demo-claude-via-open-source-models/)
demo.

Tested: 2026-11-04, ROSA HCP 4.22.12, RHOAI 3.5.2, vSR v0.4.0, with a stand-in frontier model (hard prompts not yet verified end to end).

> **Status: working with temporary workarounds.** Read
> [Decisions and temporary workarounds](#decisions-and-temporary-workarounds)
> before changing anything: several parts of this design exist only because of
> [upstream issues](#upstream-issues), and should be reverted once those are
> fixed.

## Architecture

```
 Developer laptop              OpenShift cluster (ROSA / ARO)
┌──────────────────┐          ┌────────────────────────────────────────────────────────┐
│   Claude Code    │  (1)     │  semantic-router Gateway                               │
│                  │─────────▶│    MaaS key valid? member of claude-code-users?        │
│ model:           │ Bearer   │    then strips the user's key                          │
│   vllm-sr-auto   │ MaaS key │                         │                              │
└──────────────────┘          │                         ▼ (2)                          │
                              │  vLLM Semantic Router (Envoy + router)                 │
                              │    scores the prompt's complexity                      │
                              │    holds one tier inside a tool loop                   │
                              │    rewrites "model" to the chosen tier                 │
                              │                         │                              │
                              │                         ▼ (3) router's own MaaS key    │
                              │  MaaS gateway: auth, quotas and usage for each tier    │
                              │            │                            │              │
                              │       easy ▼                       hard ▼              │
                              │  ┌──────────────────┐     ┌──────────────────────┐     │
                              │  │ Qwen3.8 27B      │     │ Frontier model       │     │
                              │  │ vLLM, local GPU  │     │ MaaS ExternalModel   │─────┼──▶ provider
                              │  └──────────────────┘     └──────────────────────┘     │
                              └────────────────────────────────────────────────────────┘
```

How a request flows:

1. **Authenticate.** Claude Code sends every request to one URL with one model
   name, `vllm-sr-auto`, and the user's MaaS API key. A dedicated Gateway checks
   the key with MaaS and requires membership of `claude-code-users`, then
   removes the key so the router never holds it.
2. **Route.** vLLM Semantic Router scores how complex the prompt is. Simple
   work goes to the local model, complex reasoning to the frontier model. Within
   a Claude Code session it can move up or down a tier between turns, but never
   in the middle of a tool loop.
3. **Govern.** The router calls the chosen tier through the MaaS gateway with
   its own key, so every model call is still authenticated, rate limited and
   metered by MaaS. Local requests never leave the cluster.

### Target (once MaaS is fixed)

Claude Code calls the MaaS gateway directly with model `vllm-sr-auto`, which
MaaS serves as an `ExternalModel` backed by vSR. MaaS then authenticates the
user, enforces their subscription and records their usage before vSR sees the
request, and the separate Gateway (step 1 above) goes away. The `maas-wiring/`
manifests for this path are already in place and work for non-streaming
requests.

## Authentication and access control

vSR v0.4.0 has no authentication of its own, so every way in is guarded in
front of it, and it holds no user credentials.

```
 Claude Code
   │  Authorization: Bearer sk-oai-<user's MaaS key>
   ▼
 [A] OpenShift Route (edge TLS) ─── the only way in: the Gateway Service is ClusterIP
   │
   ▼
 [B] semantic-router Gateway ── Kuadrant AuthPolicy (Authorino)
   │     no "Bearer sk-oai-..." key ──────────────────────────────▶ 401
   │     maas-api /internal/v1/api-keys/validate: not valid ──────▶ 403
   │     key owner not in claude-code-users ──────────────────────▶ 403
   ▼
 [C] HTTPRoute ── removes the Authorization header (vSR never sees the user's key)
   │
   ▼
 [D] TLS to vSR ── certificate checked against the OpenShift service CA,
   │                hostname semantic-router.semantic-router.svc
   ▼
 [E] NetworkPolicy ── only the two gateways' pods may connect;
   │                   everything else in the cluster times out
   ▼
 [F] vSR (Envoy + router) ── picks the tier; fails closed if the router is down
   │  Authorization: Bearer sk-oai-<vSR's own MaaS key>
   ▼
 [G] MaaS gateway ── authenticates vSR's ServiceAccount key, checks its
   │                  subscription and quota for the chosen tier
   ▼
 [H] Tier ── local vLLM, or the frontier provider with the provider API key
             that MaaS injects from a labelled Secret (verified TLS: chain,
             SNI and hostname)
```

| Layer | What it stops | How it was verified |
|:---|:---|:---|
| A. Route, ClusterIP Gateway Service | Bypassing the Route: a Gateway's default Service type (LoadBalancer) would create a public cloud load balancer | Service type checked: `ClusterIP` |
| B. AuthPolicy: no key | Anonymous requests | `401` with no credentials |
| B. AuthPolicy: invalid key | Made-up or revoked keys (validated live by `maas-api`, cached 60 s) | `403` with a fake `sk-oai-` key |
| B. AuthPolicy: group | Keys created by users who were outside `claude-code-users` at the time | **Checks the groups recorded when the key was created**, not current membership: after removing a user from the group, their existing key kept working for the full 5-minute test. MaaS describes this as a key's group snapshot ([PR #1704](https://github.com/opendatahub-io/models-as-a-service/pull/1704)). To cut off a user, **revoke their MaaS keys** as well |
| C. Header removal | The router holding, logging or forwarding the user's key | Inbound headers at vSR captured before the router ran: no `Authorization` |
| D. TLS with hostname check | A different service presenting a service-CA certificate | Gateway's Envoy config: service CA plus `match_subject_alt_names` |
| E. NetworkPolicy | Any other pod calling vSR directly, skipping B | From another namespace, the Service and pod ports 8443, 9190, 50051 and 8080 all time out |
| F. Fail closed | Unrouted requests reaching a model when the router is down (`failure_mode_allow: false`) | Router stopped: `500`/`503` until it restarted, no model reached |
| G. vSR's own identity | vSR reaching models outside its subscription | vSR's key is bound to `semantic-router-tiers`, holding only the two tiers |
| H. Provider key | Users seeing the frontier provider's API key | A non-admin user cannot get or list the Secrets holding the provider, router or database credentials |

On the **MaaS-fronted path** (Step 5), the MaaS gateway does B itself and
replaces the user's key with an injected provider key before calling vSR
(verified: an injected hex key arrives, no `sk-oai-` key), and E admits the
MaaS gateway's pods.

**Accepted risks** (see [Decisions](#decisions-and-temporary-workarounds)):

- Anything able to run in a gateway pod can reach vSR without a key (decision 4).
- B depends on an internal MaaS endpoint that may change between RHOAI
  releases (decision 2).
- The first hop has no per-model subscription check and records no per-user
  usage in MaaS; MaaS attributes tier usage to vSR's ServiceAccount
  (decisions 1 and 3).
- Removing a user from `claude-code-users` does **not** revoke keys they already
  hold: keys carry the groups recorded at creation. Revoke the user's MaaS keys
  (MaaS API or dashboard) when removing access. The same applies to the MaaS
  gateway's own group checks.
- A newly added group member cannot create a key for about 90 seconds, until
  MaaS's group cache expires.

## Prerequisites

- [`../demo-claude-via-open-source-models/`](../demo-claude-via-open-source-models/)
  deployed with MaaS and at least the Qwen model, on RHOAI 3.5.2. This demo
  adds models to that demo's `claude-code-demo-subscription` and uses its
  `claude-code-users` group.
- A **frontier model that returns canonical Anthropic Messages responses**
  (for example the Anthropic API, or Claude on Vertex AI). A LiteLLM-fronted
  endpoint does **not** work: see [upstream issue 1](#upstream-issues).
- `oc` logged in as cluster-admin, `curl`, `jq` and `openssl`.

## Installation

All commands run from this directory.

### Step 1: Register the frontier model with MaaS

Edit `external-model/external-model.yaml`: set `targetModel` to the provider's
model ID, and `external-model/external-provider.yaml`: set `provider` to match
it (`anthropic` for the Anthropic API). The ExternalModel's name is what vSR
and users call it.

Create the provider credential. `read -rs` keeps the key off the screen and out
of your shell history, and piping it in keeps it out of the process list. MaaS
only reads Secrets carrying the `inference.llm-d.ai/ipp-managed` label, and the
data key must be `api-key`:

```bash
read -rs FRONTIER_API_KEY            # paste your provider API key, then Enter
printf '%s' "$FRONTIER_API_KEY" | oc create secret generic external-provider-api-key \
  -n claude-code-demo --from-file=api-key=/dev/stdin
unset FRONTIER_API_KEY
oc label secret external-provider-api-key -n claude-code-demo inference.llm-d.ai/ipp-managed=true

# ExternalProvider.spec.endpoint is a bare hostname: no scheme, no path
sed "s/REPLACE_WITH_PROVIDER_HOSTNAME/api.anthropic.com/" external-model/external-provider.yaml | oc apply -f -
oc apply -f external-model/external-model.yaml
oc apply -f external-model/model-ref.yaml
oc apply -f external-model/auth-policy.yaml
```

A MaaS key is bound to **one** subscription, so the frontier model must join
the subscription the local models are in. Patch it rather than creating a
second one:

```bash
oc patch maassubscription claude-code-demo-subscription -n models-as-a-service \
  --type json --patch-file external-model/subscription-patch.yaml
```

Verify:

```bash
oc get externalprovider,externalmodel.inference.opendatahub.io,maasmodelref -n claude-code-demo
# The frontier MaaSModelRef should be Ready
```

### Step 2: Give vSR its own MaaS identity

vSR calls the tiers through MaaS as its own ServiceAccount, with its own key
and subscription:

```bash
oc apply -f vsr/namespace.yaml
oc apply -f maas-wiring/router-access.yaml

MAAS_API="https://maas.$(oc get ingresses.config.openshift.io cluster -o jsonpath='{.spec.domain}')"

# Create a MaaS key as the router's ServiceAccount, bound to its subscription,
# and store it in a Secret. The token goes to curl on stdin (-H @-) and the key
# goes to oc on stdin, so neither shows up in the process list. If MaaS returns
# no key, jq fails and no Secret is created.
VSR_KEY=$(printf 'Authorization: Bearer %s\n' "$(oc create token semantic-router -n semantic-router --duration=8760h)" \
  | curl -sS -H @- -H 'Content-Type: application/json' \
      -d '{"name": "semantic-router", "subscription": "semantic-router-tiers"}' \
      "$MAAS_API/maas-api/v1/api-keys" \
  | jq -er .key) \
  && printf '%s' "$VSR_KEY" | oc create secret generic semantic-router-maas-key \
       -n semantic-router --from-file=api-key=/dev/stdin
unset VSR_KEY
```

Verify the Secret holds a MaaS key (prints only the public prefix):

```bash
oc get secret semantic-router-maas-key -n semantic-router -o jsonpath='{.data.api-key}' | base64 -d | cut -c1-7
# sk-oai-
```

### Step 3: Deploy vSR

```bash
oc apply -f vsr/pvc.yaml
oc apply -f vsr/router-config.yaml
oc apply -f vsr/envoy-config.yaml
oc apply -f vsr/deployment.yaml
oc apply -f vsr/networkpolicy.yaml
oc rollout status deploy/semantic-router -n semantic-router --timeout=10m
```

The router downloads its classifier models on first start (about a minute).
Verify the complexity classifier loaded:

```bash
oc logs -n semantic-router deploy/semantic-router -c router | grep complexity_classifier_initialized
```

### Step 4: Expose vSR through its own authenticated Gateway

```bash
oc apply -f gateway/gateway.yaml
oc wait --for=condition=Programmed gateway/semantic-router-gateway -n openshift-ingress --timeout=180s
oc apply -f gateway/httproute.yaml
oc apply -f gateway/authpolicy.yaml

CLUSTER_DOMAIN=$(oc get ingresses.config.openshift.io cluster -o jsonpath='{.spec.domain}')
sed "s/REPLACE_WITH_CLUSTER_DOMAIN/${CLUSTER_DOMAIN}/" gateway/route.yaml | oc apply -f -
```

Verify the Gateway is not publicly exposed (ClusterIP, reachable only through
the Route), RHOAI added its Authorino TLS filter, and the AuthPolicy is
enforced:

```bash
oc get svc -n openshift-ingress semantic-router-gateway-data-science-gateway-class -o jsonpath='{.spec.type}{"\n"}'
# ClusterIP
oc get envoyfilter semantic-router-gateway-authn-ssl -n openshift-ingress
oc wait --for=condition=Enforced authpolicy/semantic-router -n semantic-router --timeout=120s
# authpolicy.kuadrant.io/semantic-router condition met
```

### Step 5 (optional): The MaaS-fronted path

Registers `vllm-sr-auto` as a MaaS external model, the [target
architecture](#target-once-maas-is-fixed). Today it only works for
non-streaming requests, so Claude Code cannot use it yet.

```bash
# A random key that MaaS injects when it calls vSR
openssl rand -hex 32 | tr -d '\n' | oc create secret generic semantic-router-inbound-key \
  -n claude-code-demo --from-file=api-key=/dev/stdin
oc label secret semantic-router-inbound-key -n claude-code-demo inference.llm-d.ai/ipp-managed=true
oc apply -f maas-wiring/vsr-external-model.yaml
oc apply -f maas-wiring/user-auth-policy.yaml
oc patch maassubscription claude-code-demo-subscription -n models-as-a-service \
  --type json --patch-file maas-wiring/user-subscription-patch.yaml
```

## Testing

Use a MaaS API key from a member of `claude-code-users` (see the prerequisite
demo, Step 7). Keep it out of your shell history:

```bash
export SR_URL="https://$(oc get route semantic-router -n openshift-ingress -o jsonpath='{.spec.host}')"
read -rs MAAS_KEY && export MAAS_KEY
```

Authentication is enforced:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$SR_URL/v1/messages" -d '{}'
# 401
```

An easy prompt stays local, a hard one goes to the frontier tier. The response
header `x-vsr-selected-model` shows the choice:

```bash
# Send one prompt to vllm-sr-auto; print the status line and the tier vSR chose
ask() {
  printf 'Authorization: Bearer %s\n' "$MAAS_KEY" \
    | curl -sS -o /dev/null -D - -H @- \
        -H 'anthropic-version: 2023-06-01' -H 'Content-Type: application/json' \
        --data "$(jq -nc --arg p "$1" '{model: "vllm-sr-auto", max_tokens: 300, messages: [{role: "user", content: $p}]}')" \
        "$SR_URL/v1/messages" \
    | grep -i -E '^HTTP/|^x-vsr-selected-model'
}

ask "Give a brief definition of a hash map."
# HTTP/1.1 200 OK
# x-vsr-selected-model: local-qwen

ask "Compare several approaches to designing a distributed rate limiter across regions and justify the trade-offs."
# HTTP/1.1 200 OK
# x-vsr-selected-model: frontier-...
```

## Running the demo

### Before you go on stage

- Use the MaaS API key of a **non-admin** member of `claude-code-users` (see
  the prerequisite demo, Step 7), not cluster-admin's.
- Warm up both tiers a few minutes beforehand by running the requests in
  [Testing](#testing). The first request after vLLM starts is slow, and the
  frontier provider can be slow to answer its first request.
- Open two terminals side by side with a large font.

### Terminal 1: live routing decisions

This is what the audience watches: one line per model call, showing the
decision vSR matched and the tier it picked.

```bash
oc logs -n semantic-router deploy/semantic-router -c router -f \
  | jq -R -r --unbuffered 'fromjson? | select(.msg == "routing_decision")
      | "\(.ts[11:19]) decision=\(if (.decision // "") == "" then "-" else .decision end) -> \(.selected_model)"'
```

### Terminal 2: Claude Code

```bash
unset CLAUDE_CODE_USE_VERTEX CLOUD_ML_REGION ANTHROPIC_VERTEX_PROJECT_ID ANTHROPIC_API_KEY
export ANTHROPIC_BASE_URL="https://$(oc get route semantic-router -n openshift-ingress -o jsonpath='{.spec.host}')"
read -rs ANTHROPIC_AUTH_TOKEN && export ANTHROPIC_AUTH_TOKEN   # paste the MaaS key
[ -n "$ANTHROPIC_AUTH_TOKEN" ] || echo "KEY MISSING: Claude Code would fall back to your own login"
export ANTHROPIC_MODEL=vllm-sr-auto
export ANTHROPIC_DEFAULT_OPUS_MODEL=vllm-sr-auto
export ANTHROPIC_DEFAULT_SONNET_MODEL=vllm-sr-auto
export ANTHROPIC_DEFAULT_HAIKU_MODEL=vllm-sr-auto
cd "$(mktemp -d)" && claude
```

Use `ANTHROPIC_AUTH_TOKEN`, not `ANTHROPIC_API_KEY`: the latter is sent as
`x-api-key`, which the gateway does not accept. Map all the default model
aliases, or Claude Code's background calls use Claude model IDs the gateway
does not know. Claude Code logs `unrecognized_model` for `vllm-sr-auto` and
falls back to default model limits; that is expected.

### The walkthrough

Run these in one Claude Code session, in order. Each prompt stands on its own,
so you never have to refer to step numbers.

| # | Type in Claude Code | Terminal 1 shows | Talking point |
|:--|:---|:---|:---|
| 1 | `/status` | nothing | One URL, one model name. The developer does not choose a model. |
| 2 | `Create hello.py that prints today's date, then run it.` | `decision=everything_else -> local-qwen`, one line per tool call | Everyday coding runs on the open-source model on your own GPUs, at no per-token cost. |
| 3 | `Compare three architectures for a multi-region rate limiter and justify the trade-offs.` | `decision=hard_to_frontier -> frontier-...` | The router recognised a hard reasoning task and escalated it to the frontier model, with no change on the developer's side. For Q&A: an escalated request carries the conversation so far, code included, to the frontier provider. |
| 4 | `Summarise the rate limiter design you recommended in two sentences.` | `decision=everything_else -> local-qwen` | The local model just summarised an answer the frontier model wrote: the conversation history travels with the session across models. |
| 5 | `Add a --utc flag to hello.py and test both modes.` | several `-> local-qwen` lines, never switching | Inside a multi-step task the router holds one model, so tool loops are never split across models. |

To close, point out that every call in Terminal 1 went through MaaS: the user
was authenticated before routing, and each tier call was authenticated, rate
limited and metered under the router's ServiceAccount. (Showing this in the
RHOAI usage dashboards needs the prerequisite demo's Usage Monitoring setup;
not yet verified with this demo.)

### If something goes wrong

| Symptom | Likely cause |
|:---|:---|
| A pause before the first answer of a session | Expected: Claude Code's first request is rejected (`defer_loading`, see [Known limitations](#known-limitations)) and it retries without it |
| Step 3 is slow or returns an API error | The frontier provider; check it directly through MaaS (see [Testing](#testing)) |
| `401` or `403` | Wrong key, or the user is not in `claude-code-users` (membership takes about 90 seconds to reach MaaS) |
| Terminal 1 shows nothing | The router restarted; re-run the `oc logs -f` command |

## Decisions and temporary workarounds

Revisit every row marked **temporary** when its upstream issue is fixed.

| # | Decision | Why | Cost | Revisit when |
|:--|:---|:---|:---|:---|
| 1 | **Temporary.** Claude Code reaches vSR through its own Gateway (`gateway/`), bypassing the MaaS gateway | The MaaS gateway's `stream-usage-enforcer` adds OpenAI `stream_options` to Anthropic streaming requests; vSR rejects the field, and Claude Code always streams | Users' usage of `vllm-sr-auto` is not recorded in MaaS; no per-model subscription check on the first hop (MaaS's check needs its pre-processor, which this path skips) | Upstream issue 3 (or 1) is fixed: switch Claude Code to the MaaS gateway with model `vllm-sr-auto` (Step 5), then delete `gateway/` |
| 2 | **Temporary.** The bypass AuthPolicy reuses MaaS key validation (`maas-api` `/internal/v1/api-keys/validate`) and requires `claude-code-users` | Users keep a single MaaS key | Depends on an **internal** MaaS endpoint and response shape (`valid`, `groups`) that may change between RHOAI releases | With decision 1; until then, re-test after every RHOAI upgrade |
| 3 | vSR is a MaaS backend, not an ExtProc on the MaaS gateway | MaaS parses the body (`ext_proc.ipp-pre`) before auth (`kuadrant-wasm-shim`); vSR would have to run first and so see unauthenticated requests | Two gateway hops per request; tier usage in MaaS is attributed to vSR's ServiceAccount, and tokens are counted on both hops | Only if MaaS offers a supported hook before routing that runs after auth |
| 4 | vSR has no credential check of its own; a NetworkPolicy admits only the two gateways' pods | Both gateways authenticate users; a key check on the bypass path would need the key in plain text in an HTTPRoute | Anything that can run in those gateway pods can reach vSR | Upstream vSR ships an authenticated listener in a release |
| 5 | The bypass HTTPRoute strips the user's `Authorization` header | vSR does not need the user's key and should never hold it | None | Never |
| 6 | Our own manifests, not the upstream v0.4.0 Helm chart; router and Envoy in one pod | The v0.4.0 chart crashes with the v0.4.0 image and is incompatible with OpenShift (upstream issue 2); v0.4.0 has no HTTP listener of its own, so Envoy fronts the router's ExtProc | We own the Envoy config and the Deployment | A vSR release ships a working chart and a standalone listener |
| 7 | vSR v0.4.0, images pinned by digest | Latest release; `latest` differs from `v0.4.0`; docs on `main` describe unreleased features | Pin must be bumped by hand | Each vSR release |
| 8 | Frontier tier must speak canonical Anthropic Messages, and is reached in Messages format (`api_format: anthropic`) | vSR rejects unknown fields once it has rewritten a request (upstream issue 1); LiteLLM-fronted endpoints add `usage.total_tokens` and `provider_specific_fields` | Restricts the choice of frontier provider | Upstream issue 1 is fixed |
| 9 | Both gateways verify vSR's certificate against the OpenShift service CA, including the hostname (host-specific DestinationRule with `caCertificates` and `subjectAltNames`) | RHOAI's wildcard DestinationRule `data-science-tls-rule` sets `insecureSkipVerify: true` on 443 and 8443 for in-cluster targets that have no host-specific rule | None | Never |
| 10 | vSR Deployment uses `strategy: Recreate` | One replica on a ReadWriteOnce models volume; a rolling update can land on another node where the volume cannot attach | Brief outage on every rollout | vSR runs with shared or no persistent storage |
| 11 | Session stickiness: protection in `conversation` scope, keyed on Claude Code's `x-claude-code-session-id` (as both session and conversation identity), switch margin 0 | Claude Code sends only a session id. `session` scope never releases the first tier, so a session that starts easy could never escalate; `conversation` scope lets a changed decision switch tiers at a turn boundary while the tool-loop lock holds mid-task | The session also steps back down to the local tier on the next easy turn | When tuning the routing, or if vSR adds an escalate-only mode |
| 12 | Every decision lists both tiers (`algorithm: static`, preferred tier first) | Protection can only hold a model that the matched decision admits; with one tier per decision it returns 503 when the session is on the other | None | Never |

## Known limitations

- **Claude Code runs in degraded mode.** vSR v0.4.0 rejects `tools[].defer_loading`
  (`not supported by the protocol-neutral request contract`), so Claude Code's
  first request in each session fails with 400 and it falls back to a request
  without deferred tool loading. Every tool definition is then sent on every
  call (a one-file task used about 21,600 prompt tokens). Upstream issue 4.
- The complexity signal only has a handful of example prompts in
  `vsr/router-config.yaml`; tune them before relying on the routing.
- Tool-loop continuation requests were classified on the user's prompt, not the
  tool result, in testing, so a mid-task switch was never proposed. The
  protection tool-loop lock itself is therefore untested; test it once the
  frontier tier works.
- With the LiteLLM-fronted test endpoint as the frontier tier, **buffered**
  responses are rejected by vSR (502) but **streamed** responses passed in
  testing. Claude Code always streams, so it may work; a canonical Anthropic
  provider is still the requirement (decision 8).
- MaaS caches group membership: after adding a user to `claude-code-users`,
  creating their MaaS key fails with `Unable to resolve a subscription` for
  about 90 seconds.
- Not yet tested: the thinking-block handover from a Claude frontier model to
  the local tier, and the frontier tier with a canonical Anthropic provider.

## Verified so far (2026-11-03, RHOAI 3.5.2, vSR v0.4.0)

- Bypass gateway: no credentials returns 401, a wrong key 403, a valid MaaS key
  from `claude-code-users` 200 (buffered and streaming).
- The user's MaaS key never reaches vSR on either path (bypass: `Authorization`
  stripped; MaaS path: replaced by the injected provider key).
- NetworkPolicy: from another namespace the vSR Service and every pod port
  (8443, 9190, 50051, 8080) are unreachable.
- MaaS gateway to the external provider: certificate chain verified against
  system roots, with SNI and hostname checks.
- Routing: easy prompts go to the local tier, hard prompts to the frontier
  tier; within one session a hard turn escalates and the next easy turn steps
  back down.
- Claude Code (headless, `Read` tool) completes a task through vSR, after the
  `defer_loading` fallback (known limitation).
- A non-admin user in `claude-code-users` can create their own MaaS key and use
  Claude Code through vSR, and cannot read the provider, router or database
  Secrets.
- The full walkthrough in [Running the demo](#the-walkthrough), run
  interactively in Claude Code as a non-admin user (frontier tier: the
  gpt-oss-120b test endpoint): routing, escalation, history across tiers and a
  stable multi-step tool loop all behaved as described.
- Fails closed: with the router process stopped, requests return 500 (then 503
  while the pod is not ready) and none reach a model; service resumes when the
  router restarts (about 45 seconds).

## Assumptions (unverified)

- MaaS's internal key validation endpoint and response shape stay stable
  across RHOAI 3.5.x patch releases (decision 2).
- Claude Code's default context window for an unrecognised model (`vllm-sr-auto`)
  is no larger than the smallest tier's (Qwen: 262,144 tokens; the frontier
  model's must be checked).
- The Anthropic API itself rejects the `stream_options` field MaaS injects
  (it would make issue 3 affect MaaS's own Anthropic passthrough too).

## Upstream issues

| # | Project | Issue | Blocks |
|:--|:---|:---|:---|
| 1 | vllm-project/semantic-router | Unknown fields are rejected after any rewrite, with no option to drop them (`llmprotocol.DefaultPolicy()`) | LiteLLM-fronted frontier providers; also MaaS's `stream_options` |
| 2 | vllm-project/semantic-router | v0.4.0 Helm chart defaults (`--secure=false`, `LD_LIBRARY_PATH=/app/lib`) do not match the v0.4.0 `vllm-sr` image; fixed UID 65532 and `storageClassName: standard` break on OpenShift | Using the chart (decision 6) |
| 3 | opendatahub-io MaaS (`ai-gateway-payload-processing`) | `stream-usage-enforcer` injects OpenAI `stream_options` into Anthropic Messages streaming requests | The MaaS-fronted path for Claude Code (decision 1) |
| 4 | vllm-project/semantic-router | `tools[].defer_loading` is rejected | Claude Code's deferred tool loading |

## Cleanup

```bash
oc delete route semantic-router -n openshift-ingress
oc delete -f gateway/authpolicy.yaml -f gateway/httproute.yaml -f gateway/gateway.yaml
oc delete -f maas-wiring/vsr-external-model.yaml -f maas-wiring/user-auth-policy.yaml 2>/dev/null
oc delete -f vsr/networkpolicy.yaml -f vsr/deployment.yaml -f vsr/envoy-config.yaml -f vsr/router-config.yaml -f vsr/pvc.yaml
oc delete -f maas-wiring/router-access.yaml
oc delete -f external-model/auth-policy.yaml -f external-model/model-ref.yaml -f external-model/external-model.yaml
oc delete externalprovider external-frontier semantic-router -n claude-code-demo
oc delete secret external-provider-api-key semantic-router-inbound-key -n claude-code-demo
oc delete -f vsr/namespace.yaml
# Then remove the gpt-oss / vllm-sr-auto entries from claude-code-demo-subscription
# (oc edit maassubscription claude-code-demo-subscription -n models-as-a-service)
```
