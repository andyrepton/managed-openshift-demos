# demo-semantic-router-claude-code

vLLM Semantic Router (vSR) picks a model tier per request for Claude Code, on
top of `../demo-claude-via-open-source-models/` (models and MaaS only).

## Architecture (decided 2026-11-03)

vSR is a **MaaS backend**, not an ExtProc on the MaaS gateway:

```
Claude Code -> MaaS gateway (user key, model vllm-sr-auto) -> vSR (Envoy + router)
            -> MaaS gateway again (vSR's own key, rewritten model) -> tier
```

MaaS authenticates the user before vSR sees anything. The ExtProc placement
was rejected: MaaS's pre-processor (`ext_proc.ipp-pre`) runs **before** auth
(`kuadrant-wasm-shim`), and vSR would have to run before that, so it would see
request bodies unauthenticated. Trade-off accepted: tier usage in MaaS is
attributed to vSR's ServiceAccount, not the user, and tokens are counted on
both hops.

## vSR v0.4.0 (verified on the cluster)

- Upstream rates its OpenShift, KServe, Istio and llm-d paths as
  "Experimental example".
- v0.4.0 has **no HTTP listener**: the router only serves ExtProc (gRPC 50051).
  The built-in standalone listener exists only on `main`, unreleased. Our pod
  runs Envoy in front. Read docs at the **v0.4.0 tag**, not `main`: half of
  `main`'s install docs describe features v0.4.0 lacks.
- The v0.4.0 Helm chart does not work with the v0.4.0 `vllm-sr` image. The
  entrypoint `/app/start-router.sh` takes the **config path** as its argument
  (not `--secure=false`), and the image's `LD_LIBRARY_PATH=/usr/local/lib`
  must not be overridden. The chart also hardcodes UID 65532 (rejected by
  OpenShift `restricted-v2`) and `storageClassName: standard`. Hence our own
  manifests.
- Pin images by digest; `latest` and `v0.4.0` differ.
- The router downloads its classifier models itself (no init container).
- vSR rewrites the body `model` to the backend's `provider_model_id`.
- **Strict protocol decoding.** After any rewrite, unknown fields are rejected
  (`llmprotocol.DefaultPolicy()`, not configurable in v0.4.0). This breaks:
  MaaS adding `stream_options` to Messages streams (all Claude Code traffic),
  and LiteLLM-fronted providers (`usage.total_tokens`,
  `provider_specific_fields`).

## MaaS wiring (verified)

- `ExternalProvider` `provider: openai` makes MaaS **replace** `Authorization`
  with the injected key; `provider: anthropic` injects `x-api-key` and drops
  `Authorization`. Either way the user's MaaS key never reaches vSR.
- MaaS reached vSR's OpenShift service-CA certificate without a custom CA.
  Unexplained so far: check whether MaaS verifies upstream certificates at all.
- vSR has its own ServiceAccount, MaaS key and subscription for the tiers.

## Upstream issues and the temporary bypass (as of 2026-11-03)

Andy is filing these. No request/response-rewriting workarounds, by decision;
the README's "Decisions and temporary workarounds" table lists what to revert
when each is fixed.

1. vllm-project/semantic-router: configurable unknown-field policy (v0.4.0
   rejects MaaS's `stream_options` and LiteLLM's extra response fields).
2. vllm-project/semantic-router: v0.4.0 Helm chart does not match its image.
3. MaaS `stream-usage-enforcer` injects OpenAI `stream_options` into Anthropic
   Messages streaming requests. Because of this, Claude Code reaches vSR
   through its own Gateway (`gateway/`) instead of the MaaS gateway.
4. vllm-project/semantic-router: `tools[].defer_loading` is rejected, so
   Claude Code falls back to sending every tool definition on every call.

The frontier tier must return canonical Anthropic Messages responses; a
LiteLLM-fronted endpoint does not.

## Debugging gotchas (verified)

- **Envoy access logs show headers after filters ran.** vSR's router rewrites
  `Authorization` to its own MaaS key (also `sk-oai-...`), so
  `%REQ(AUTHORIZATION)%` in vSR's Envoy log is the outbound credential, not
  what arrived. To see the inbound header, copy it to dynamic metadata with
  `header_to_metadata` before `ext_proc` (truncate with `regex_value_rewrite`;
  `DYNAMIC_METADATA` takes no length).
- The bypass Gateway needs `security.opendatahub.io/authorino-tls-bootstrap: "true"`,
  or its wasm-shim cannot reach Authorino (TLS) and every request returns 500.
- Gateways default to a LoadBalancer Service (a public cloud load balancer).
  Set ClusterIP through `infrastructure.parametersRef`.
- `oc debug` of the vSR pod hangs: the copy cannot mount the ReadWriteOnce
  models volume. Read the image config from the registry instead.
- An empty `ANTHROPIC_AUTH_TOKEN` makes Claude Code fall back to the user's own
  Claude login. Guard test scripts so they stop when the key is missing.
