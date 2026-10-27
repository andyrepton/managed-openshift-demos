# demo-developer-hub

## RHDH version: pinned to 1.10.5

Install from the stock `redhat-operators` catalog, channel `fast-1.10`. Re-check
the catalog before assuming 2.x is available; do not plan around it.

- 2.x images have not reached `registry.redhat.io`, and redirecting them needs
  an `ImageDigestMirrorSet`, which ROSA HCP denies (it belongs to the
  HostedCluster). Do not infer a shipped version from a git branch or a
  Makefile `VERSION`.
- 2.x ships an **OpenShift auth plugin**, which would let RHDH sign in with
  cluster identity. Waiting for it is deliberate: do not build elaborate auth
  workarounds meanwhile. Until then, sign-in is GitHub via a GitHub App.
- Nothing else needed is missing from 1.10: its `lightspeed` flavour already
  has the MCP tool runtime and `mcp_servers`.

1.10 specifics that bite:

- The CR is `rhdh.redhat.com/v1alpha5` (the version with `spec.flavours`).
- The operator names both the Deployment and the Route `backstage-<cr-name>`.
- The `lightspeed` flavour is `enabledByDefault: true` and silently adds an
  `init-rag-data` init container and a `lightspeed-core` sidecar. Disable with
  `flavours: [{name: lightspeed, enabled: false}]`. (In 2.x it is called
  `intelligent-assistant`.)

## Cluster sign-in

The cluster OAuth server is plain OAuth2 (`authorization_code`, scopes
`user:info` / `user:full`), not OIDC: only the generic `oidc` provider is ruled
out. `/.well-known/openid-configuration` on a ROSA cluster is the
ServiceAccount token issuer and cannot run a browser login.
