# demo-developer-hub

## RHDH version: the 1.10 line

Install from the stock `redhat-operators` catalog, channel `fast-1.10`. The
`fast-1.10` channel installs the newest 1.10 release, and that is accepted: the
pin is to the 1.10 line, not a patch release.

RHDH 2.1 is GA (2026-11-09, channel `fast-2.1`, RHEL 10 images on
`registry.redhat.io`; there was no 2.0). The demos stay on 1.10 by decision:
2.1 is a breaking upgrade and brings nothing these demos need.

- **There is no OpenShift auth provider in RHDH, in 2.1 or any release.** Red
  Hat closed the request as Won't Do (RHDHPLAN-449, 2025-01-22), citing logout
  and getting users into the catalog. The 2.1 sign-in page has a fixed provider
  list with no OpenShift entry. Do not plan a move to 2.x around it. Upstream
  has a community module (`@backstage/plugin-auth-backend-module-openshift-provider`;
  0.1.10 matches 2.1's package versions, nothing matches 1.10), which would
  need its own dynamic plugin build, a custom sign-in page plugin and catalog
  users matching OpenShift usernames, all unsupported. Sign-in stays GitHub via
  a GitHub App.
- What a move to 2.1 costs: it runs the Backstage New Frontend System only, so
  every custom frontend plugin needs a rewrite (default-export
  `createFrontendPlugin`, `PageBlueprint`, `FormFieldBlueprint`) and the
  `dynamicPlugins.frontend` YAML wiring goes away. Auth providers ship as
  separate dynamic plugins, disabled by default, and the bundled
  `./dynamic-plugins/dist/...` wrappers are gone. A worked migration of these
  demos (tested on a cluster, READMEs not updated) is on the branch
  `rhdh-2.1`.
- Nothing needed is missing from 1.10: its `lightspeed` flavour already has the
  MCP tool runtime and `mcp_servers`.

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
