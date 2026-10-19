# Dev Spaces Self-Service

A developer asks for a Dev Space in Red Hat Developer Hub — how many, how big,
which AI assistant, where its model lives — and gets a namespace, a quota and a
workspace definition, created on the cluster in their name.

Sibling to [demo-aro-cluster-planner](../demo-aro-cluster-planner), with one
important difference: **that one shows you what it would do, this one does it.**

## Overview

* **Sized, not guessed** — totals divide across the workspaces asked for, with
  the editor's own appetite accounted for and a floor below which a workspace
  cannot start.
* **A real quota** — `ResourceQuota` and `LimitRange`, so the namespace is
  bounded rather than nominally sized.
* **AI assistants already in the image** — Kilo and OpenCode are baked into the
  workspace image and selected per request, so nothing is downloaded at start.
* **Credentials handled properly** — a third-party API key becomes a Secret
  mounted as environment variables, never written into a devfile bound for git.
* **A scoped credential** — a dedicated ServiceAccount that can create but
  never delete, with everything it makes findable by one label.

Depends on **[demo-developer-hub](../demo-developer-hub)** for RHDH,
**[openshift-devspaces](../openshift-devspaces)** for Dev Spaces, and
**[demo-custom-udi](../demo-custom-udi)** for the workspace image.

## What a request produces

| Object | Why |
| --- | --- |
| `Namespace` | Labelled so Dev Spaces **adopts** it rather than making its own |
| `ResourceQuota` | The thing that actually caps the namespace |
| `LimitRange` | Defaults for anything created without its own resources |
| `Secret` | Only for a third-party AI key, mounted as env vars |
| `devfile.yaml` | Yours to use. Names the image explicitly — see Notes |

## Prerequisites

1. [demo-developer-hub](../demo-developer-hub) — RHDH with GitHub sign-in.
2. [openshift-devspaces](../openshift-devspaces) — the operator and CheCluster.
3. [demo-custom-udi](../demo-custom-udi) — built, with its capabilities
   published. Without it the form offers no assistants and says why.
4. For the in-cluster AI option only:
   [demo-vllm-model-serving](../demo-vllm-model-serving) must be deployed and
   `devspacesSelfService.inClusterAiBaseUrl` set. Absent, the option is hidden
   rather than offered and broken.

## Setup

### 1. Permissions

```bash
oc apply -f rbac/provisioner.yaml
```

Read that file before applying it — it is the only thing in this repo that lets
RHDH create a namespace, and the comments explain each grant and each
deliberate omission.

### 2. Mount the credential

RHDH runs as the `default` ServiceAccount, shared by every plugin in the pod.
Granting `default` the right to create namespaces would grant it to all of
them, so the provisioner's token is mounted separately — already wired into
[demo-developer-hub/backstage.yaml](../demo-developer-hub/backstage.yaml) and
named in app-config:

```yaml
devspacesSelfService:
  credentialDir: /var/run/secrets/devspaces-provisioner
```

Without that key the plugin falls back to the pod's own ServiceAccount, which
cannot create namespaces, and **says so at startup** rather than failing on
first submit.

### 3. Build and load the plugins

```bash
yarn install
yarn workspace @devspaces/backstage-plugin-devspaces-self-service-backend test

for p in devspaces-self-service devspaces-self-service-backend; do
  (cd plugins/$p && yarn build && \
     npx @red-hat-developer-hub/cli@release-1.10 plugin export --clean)
done
npx @red-hat-developer-hub/cli@release-1.10 plugin package --export-to ./plugin-registry
printf 'FROM scratch\nCOPY . /\n' > plugin-registry/Containerfile

# Strip node_modules/.bin before building the image.
#
# Those entries are relative symlinks in dist-dynamic, but `plugin package`
# resolves them to absolute paths when it copies, so the tarball ends up
# containing links to the build machine's home directory - published in a
# public image. The installer skips them anyway, so nothing is lost.
find plugin-registry -name .bin -type d -prune -exec rm -rf {} +

oc start-build devspaces-self-service -n rhdh --from-dir=plugin-registry --follow
```

Both plugins ship in one image, pushed to `quay.io/<you>/rhdh-plugins` with a
`<plugin>-<version>` tag so several demos' plugins can share one repository.
See [demo-aro-cluster-planner](../demo-aro-cluster-planner) for the
`FROM scratch` and `!<plugin-path>` requirements, which apply here too.

Then compose this demo's entry into RHDH's plugin config and apply it:

```bash
cd ../demo-developer-hub
python3 -I scripts/compose-dynamic-plugins.py \
  ../demo-rhdh-devspaces-self-service/rhdh/dynamic-plugins-entry.yaml --apply

oc -n rhdh rollout restart deployment/backstage-developer-hub
```

The entry lives in [`rhdh/dynamic-plugins-entry.yaml`](rhdh/dynamic-plugins-entry.yaml)
rather than in demo-developer-hub so that the base demo deploys on its own. The
plugin installer runs as an **init container** with no top-level exception
handler, so an image it cannot pull is not a missing plugin -- it is a pod stuck
in `Init:Error`. Listing this plugin there meant anyone deploying just Developer
Hub got one that never started, because of a plugin they had never built.

### 4. Verify

Open **Request a Dev Space** in the sidebar. The form should list the
assistants your image actually carries, with their versions, and show your
namespace name in the panel on the right.

## Who can provision

**Guest and anonymous callers are refused outright**, and not because of how
this cluster happens to be configured.

Guest is an installation-wide sign-in provider controlled by
`auth.environment`, not a per-plugin setting — you cannot have one plugin
accept guests and another refuse them. Since this endpoint creates namespaces
with a privileged ServiceAccount, it checks for itself rather than inheriting
whatever another demo sets that switch to.

The caller's identity comes from Backstage's **verified credentials**
(`httpAuth` with `allow: ['user']`), never from a header. An earlier version
read `x-backstage-user-entity-ref`, which any client can set — anyone reaching
the endpoint could have claimed to be anyone and had a namespace created in
their name. There is a test that fails if that fallback ever returns.

The namespace is always `<caller>-devspaces`, derived from the signed-in
identity. A username in the request body would be a way to provision in
someone else's name, so the body's is ignored.

## How the assistant selection reaches the workspace

Ticking Kilo or OpenCode puts a `DEFAULT_EXTENSIONS` entry in the workspace's
container, and che-code installs from those paths at editor startup. Nothing is
downloaded; the `.vsix` files are already in the image.

For that to mean anything, **this plugin creates the workspace** rather than
leaving a devfile for someone to apply. Earlier it did the latter, and the
effect was that the checkboxes changed a file nobody used: Dev Spaces creates
workspaces from whichever devfile it is handed, so one started from the
dashboard got the cluster default image and no extensions.

Creating a workspace by hand means doing what the dashboard does:

* **A `DevWorkspaceTemplate` for the editor.** Verified on Dev Spaces 3.30 -- a
  `DevWorkspace` with no `contributions` gets no editor injected and no template
  created for it. The che-code definition is copied verbatim out of the
  `editors-definitions` ConfigMap; its `commands`, `components` and `events`
  become the template's `spec`, which is exactly what a dashboard-made template
  contains.
* **A `DevWorkspace`** referencing that template, with the generated components
  as its own. This is where `DEFAULT_EXTENSIONS` lands.

The editor definition is copied as YAML rather than parsed and re-emitted.
Server-side apply accepts YAML, so a document we do not own goes through
untouched and the backend needs no YAML parser.

Workspace creation is **best-effort**. A namespace with a quota is useful on its
own, so if the editor definition cannot be read the request still succeeds and
says what was and was not created, rather than discarding the work.

## Sizing

Totals divide evenly across the workspaces requested, then:

* **The editor takes a share.** che-code is injected into the workspace pod and
  runs *inside* the dev container, so it comes out of the same limit. Roughly
  500m and 1 GiB. A workspace sized at exactly what the application needs
  leaves the editor nothing, and the symptom is Code - OSS failing to start
  with no useful message. Requests below 500m / 2 GiB per workspace are refused
  with an explanation rather than accepted and broken.
* **Requests are half of limits.** A workspace is idle most of the time —
  someone is reading, not compiling — so reserving the ceiling wastes most of
  the cluster.
* **The pod quota has headroom of one.** Restarting a workspace briefly runs
  the new pod alongside the old one; a quota of exactly N makes that fail
  rather than wait.

**A number the form cannot enforce:** `maxNumberOfRunningWorkspacesPerUser` is
a CheCluster field and therefore cluster-wide. If it is lower than the
workspace count requested, it wins — the quota permits what Che then refuses.
The panel says so when more than one workspace is asked for.

## AI assistants

Selected, not installed. The `.vsix` files are already in the image and
`DEFAULT_EXTENSIONS` is a semicolon-separated list of absolute paths che-code
installs at editor startup, so **one image serves every combination** and
choosing none means omitting the variable. Verified on Dev Spaces 3.30:

```
DefaultExtensionsInstaller: Found 2 default extension(s) in DEFAULT_EXTENSIONS
  Installing extension from /opt/extensions/kilocode.vsix
  Successfully installed extension from /opt/extensions/kilocode.vsix
```

127 MB of Kilo installed in under four seconds from local disk, against ~190 MB
pulled over the network on every workspace start with the download approach.

**OpenCode is really two things.** The extension is about 2 KB of JavaScript
that opens a terminal; the CLI binary is the actual tool. They are offered as
one choice, because a button that launches a binary that is not there would be
a strange thing to select on its own.

### Where the model lives

| Choice | Where the endpoint comes from |
| --- | --- |
| None | — |
| In-cluster | `devspacesSelfService.inClusterAiBaseUrl`, hidden if unset |
| Third-party | Typed in; stored as a Secret |

A third-party key goes into a Secret labelled
`controller.devfile.io/mount-to-devworkspace` and
`controller.devfile.io/watch-secret`, annotated
`controller.devfile.io/mount-as: env`. Dev Spaces then exposes it as
`AI_API_KEY` in every workspace container. It is never written to the devfile,
never echoed back in a response, and the preview shows `REPLACE_ME`.

## Why there is no editor choice

The form offers che-code and nothing else, deliberately. The cluster publishes
twelve editor definitions and **exactly one of them runs in a browser**:

| Editor | Experience |
| --- | --- |
| `che-incubator/che-code/latest` | VS Code, **in the browser** |
| `che-incubator/che-code-sshd/latest` | VS Code **desktop**, over SSH |
| `che-incubator/che-idea-server/latest` | IntelliJ IDEA **Ultimate**, desktop |
| + GoLand, PyCharm Pro, CLion, PhpStorm, Rider, RubyMine, Kiro, Toolbox | all desktop |

Every JetBrains option runs an IDE *server* in the workspace that the user
attaches to from a locally installed Gateway, and most are commercial products
needing the user's own licence. Browser-based JetBrains is gone.

More decisively: `DEFAULT_EXTENSIONS` is a che-code mechanism. Under any
JetBrains editor the AI extensions silently do not install — the `.vsix` files
sit unused — while the OpenCode CLI still works, because it is a binary in a
terminal. Offering the choice would mean offering combinations that quietly do
less than they appear to.

## Layout

```
plugins/devspaces-self-service-backend/
  src/sizing.ts         Totals -> per-workspace limits and a quota
  src/manifests.ts      Namespace, quota, limit range, secret
  src/devfile.ts        The devfile, and the factory URL
  src/plan.ts           A request -> everything it implies. Pure
  src/provision.ts      The only part that writes
  src/capabilities.ts   What this cluster offers, read from this cluster
  src/identity.ts       Who may provision
  src/kube.ts           A very small Kubernetes client
plugins/devspaces-self-service/
  src/components/       The request form and the preview panel
rbac/provisioner.yaml   The ServiceAccount and exactly what it may do
```

`plan.ts` is pure and is what both the preview and the provisioner use, so what
a user approves and what gets applied cannot drift. The only thing provisioning
adds is the real API key.

## Notes

* **A devfile naming its own image overrides the CheCluster `defaultComponents`.**
  The generated devfile therefore names the custom UDI explicitly. Relying on
  the cluster default would work until someone requested an assistant, at which
  point they would get the stock UDI with no `.vsix` files and an editor that
  installs nothing.
* **Pre-creating the namespace avoids a cluster-wide change.** Dev Spaces adopts
  an existing namespace that carries `app.kubernetes.io/part-of: che.eclipse.org`,
  `app.kubernetes.io/component: workspaces-namespace` and
  `che.eclipse.org/username: <user>`. The documented alternative is
  `defaultNamespace.autoProvision: false`, which is cluster-wide and would stop
  every existing user getting a namespace at all.
* **The namespace name must match `defaultNamespace.template`** — `<username>-devspaces`
  here. Get it wrong and Che provisions a second namespace alongside: the quota
  lands on one and the workspace on the other, so nothing is enforced and
  nothing says why.
* **A quota of zero PVCs rejects a workspace; omitting the key does not.** For
  ephemeral storage the keys are left out rather than set to `0`.
* **The provisioner cannot delete.** There is no delete verb in its ClusterRole,
  so a bug in this plugin cannot remove a namespace. Clean-up is deliberately a
  human action.
* **RBAC cannot restrict namespace creation by name** — there is no
  `resourceNames` matching on `create`, because the object does not exist yet.
  The `<username>-devspaces` pattern is enforced in the plugin, from the
  signed-in identity. Treat that as the control and the ClusterRole as the
  backstop.
* **The provisioner's token is long-lived, not projected.** A projected
  `serviceAccountToken` volume can only project the pod's *own* ServiceAccount;
  there is no way to project a second one. `oc delete secret
  devspaces-provisioner-token -n rhdh` revokes it immediately.
* **Server-side apply, not create.** Re-submitting a request converges instead
  of failing with a 409, so adjusting a quota and submitting again does the
  obvious thing.
* **It refuses to adopt a namespace it does not recognise.** One that exists
  without this plugin's label, and without being Che's for that user, belongs
  to something else — applying a quota over the top is how a self-service tool
  breaks someone's project.

## Clean Up

```bash
# Everything the plugin ever created, by one label
oc get ns -l app.kubernetes.io/managed-by=devspaces-self-service

oc delete -f rbac/provisioner.yaml
oc -n rhdh delete bc/devspaces-self-service is/devspaces-self-service
```

Namespaces are left for you to remove deliberately — the provisioner has no
delete verb, and neither should an automated clean-up of someone's workspace.

## Related Demos

* **[Red Hat Developer Hub](../demo-developer-hub)** — the RHDH instance this plugs into.
* **[Custom UDI](../demo-custom-udi)** — the workspace image and its assistants.
* **[OpenShift Dev Spaces](../openshift-devspaces)** — the operator and CheCluster.
* **[Deployment Planner](../demo-aro-cluster-planner)** — the sibling plugin, which previews rather than provisions.
