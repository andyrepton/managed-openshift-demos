# Red Hat Developer Hub on ROSA/ARO

Install Red Hat Developer Hub (RHDH) 1.10 as the base other demos plug into: the software catalog, the dynamic-plugin loader, and GitHub sign-in restricted to a named list of people.

## Overview

* **RHDH 1.10.5** -- installed via OLM from the standard `redhat-operators` catalog.
* **Software catalog** -- two teams, a sample system and component, loaded from this repo.
* **Software catalog from git** -- entities read from a public repo, unauthenticated.
* **GitHub sign-in** -- via a GitHub App, with the software catalog as the access list.

Verified on ROSA HCP, OpenShift 4.22.12.

## Prerequisites

* A ROSA, ARO or OSD cluster with `cluster-admin`. Build one with `../andys-demo-cluster-tf` using `basic_rosa.tfvars` or `basic_aro_hcp.tfvars` -- this demo is provider-agnostic.
* `oc` CLI, logged in.
* A **GitHub App** for sign-in. See [Set up sign-in](#2-set-up-sign-in).

No GitHub personal access token is needed. The catalog is read from a public repository and this demo performs no git writes.

## How to Run the Demo

### 1. Install the operator

RHDH 1.10 ships in the catalog OpenShift already has, so there is no CatalogSource to create:

```bash
oc apply -f operator/subscription.yaml
```

Wait for the CSV:

```bash
oc get csv -n rhdh-operator
# NAME                   DISPLAY                          VERSION   PHASE
# rhdh-operator.v1.10.5  Red Hat Developer Hub Operator   1.10.5    Succeeded
```

### 2. Set up sign-in

Register a **GitHub App** at <https://github.com/settings/apps/new>. Red Hat recommends a GitHub App over an OAuth App: fine-grained permissions and short-lived tokens.

| Field | Value |
| --- | --- |
| GitHub App name | anything unique, e.g. `rhdh-demo-signin` |
| Homepage URL | `https://<your-rhdh-host>` |
| Authorization callback URL | `https://<your-rhdh-host>/api/auth/github/handler/frame` |
| Webhook | clear **Active** -- no webhook is used |
| Organization permissions | Members: `Read-only` |
| Where can this GitHub App be installed | `Any account`, if anyone but you will ever sign in -- this radio exists only on this form |

Generate a client secret, then install the app on your account.

Add yourself to `catalog/org.yaml` as a `User` whose `metadata.name` is your GitHub login. **That file is the access list** -- GitHub authenticates anyone, the catalog decides who gets in.

### 3. Create the secrets

```bash
oc create namespace rhdh

oc -n rhdh create secret generic rhdh-secrets \
  --from-literal=BACKEND_SECRET="$(openssl rand -base64 24)" \
  --from-literal=SESSION_SECRET="$(openssl rand -base64 24)" \
  --from-literal=GITHUB_APP_CLIENT_ID="${GITHUB_APP_CLIENT_ID}" \
  --from-literal=GITHUB_APP_CLIENT_SECRET="${GITHUB_APP_CLIENT_SECRET}" \
  --from-literal=GITHUB_ORG="andyrepton" \
  --from-literal=GITHUB_REPO="managed-openshift-demos" \
  --from-literal=CATALOG_BRANCH="main"
```

`secrets/rhdh-secrets.yaml` documents the shape of the Secret with `REPLACE_ME` placeholders. Do not commit a filled-in copy.

There is deliberately no GitHub personal access token in it. The two `GITHUB_APP_*` values belong to a sign-in app and grant no repository access.

### 4. Apply the configuration

```bash
oc apply -f app-config/app-config-rhdh.yaml
oc apply -f app-config/dynamic-plugins.yaml
```

### 5. Deploy RHDH

```bash
oc apply -f backstage.yaml
oc -n rhdh rollout status deployment/backstage-developer-hub --timeout=10m

echo "https://$(oc get route backstage-developer-hub -n rhdh -o jsonpath='{.spec.host}')"
```

Raise the Route timeout. The default is 30 seconds, which is shorter than a
reasoning model takes to answer, so the planner's assistant returns a bare 504
with nothing in the backend log:

```bash
oc annotate route backstage-developer-hub -n rhdh \
  haproxy.router.openshift.io/timeout=10m --overwrite
```

Sign in with **GitHub**. Only accounts with a matching `User` entity in `catalog/org.yaml` are admitted.

### 6. Verify

1. Open **Catalog**. You should see `payments-api`, the `payments` system and two groups.
2. Open **Deployment Planner** in the sidebar, if you have also installed [demo-rhdh-cluster-planner](../demo-rhdh-cluster-planner).

## Granting someone else access

`catalog/org.yaml` is the access list and nothing else is. GitHub will
authenticate anyone with an account; `usernameMatchingUserEntityName` is the only
resolver configured, so a login becomes a session only if a `User` entity has the
same name.

1. Add a `User` to `catalog/org.yaml` whose `metadata.name` is their **GitHub
   login** -- the last segment of their profile URL, spelled exactly as GitHub
   spells it, not their display name or email:

   ```yaml
   ---
   apiVersion: backstage.io/v1alpha1
   kind: User
   metadata:
     name: <github-login>
   spec:
     profile:
       displayName: <Their Name>
     memberOf: [platform-team]
   ```

2. Add the same login to that Group's `members:` list. The membership relation
   is emitted from either side, so this is redundant -- but `org.yaml` states
   both for `andyrepton`, and a file where only one person appears in both
   places reads like a mistake.

3. Push the commit to the branch RHDH is reading. The catalog is fetched over
   HTTPS from GitHub, not from your checkout, so until the commit is on that
   branch nothing changes:

   ```bash
   oc -n rhdh get secret rhdh-secrets -o jsonpath='{.data.CATALOG_BRANCH}' | base64 -d
   ```

4. Wait for the next catalog refresh, or force one.

   **Restarting the deployment does not do this.** The catalog lives in
   PostgreSQL and survives the pod, so a restart changes nothing. Neither does
   refreshing the `Location` entity: `org.yaml` is pulled in as a *target* of
   `all.yaml` rather than being a `Location` of its own, so the refresh stops at
   the parent and never re-reads the file your user is in.

   What works is refreshing an entity that `org.yaml` already manages, which
   re-reads the file it came from and picks up its new siblings. In the UI, open
   any existing user (for example **andyrepton**) and use the refresh button. Or
   over the API, with a token:

   ```bash
   curl -X POST -H "Authorization: Bearer <token>" -H 'Content-Type: application/json' \
     -d '{"entityRef":"user:default/andyrepton"}' \
     "https://<your-rhdh-host>/api/catalog/refresh"
   ```

5. Confirm the entity landed before they try to sign in. A missing `User` and a
   broken GitHub App look identical from the login page:

   ```bash
   oc -n rhdh logs deployment/backstage-developer-hub -c backstage-backend \
     | grep -i 'unable to resolve user identity'
   ```

They do not need to install the GitHub App, but the App has to be **public**.
Only the owning account can authorize a private one, so everyone else gets a bare
**404** at `github.com/login/oauth/authorize` -- GitHub answers 404 rather than
403 so the App's existence is not disclosed. Nothing appears in the RHDH logs,
because the request never reaches RHDH.

Where you set that depends on whether the App exists yet. On the registration
form it is the *Where can this GitHub App be installed?* radio. Afterwards that
radio is gone, and it lives in an unlikely place:

> **Settings -> Developer settings -> GitHub Apps -> your App -> Advanced ->
> Danger zone -> Make public**

Making the App public does not widen who can use this instance. It lets anyone
*start* the OAuth flow; `catalog/org.yaml` still decides who finishes it. The two
settings do different jobs and both are needed -- GitHub for authentication, the
catalog for authorisation.

If public is unacceptable, the other route is to transfer the App to a GitHub
organization and add the person to it: members of the owning organization may
authorize a private App. A personal-account App has no equivalent -- there is no
invite-one-person mode.

## What gets created

| Path | Purpose |
| --- | --- |
| `operator/subscription.yaml` | Namespace, OperatorGroup and Subscription (channel `fast-1.10`) |
| `secrets/rhdh-secrets.yaml` | Reference shape for the Secret (placeholders only) |
| `app-config/app-config-rhdh.yaml` | Auth, GitHub integration, catalog locations |
| `app-config/dynamic-plugins.yaml` | Dynamic plugin set |
| `backstage.yaml` | The `Backstage` CR (`rhdh.redhat.com/v1alpha5`) |
| `catalog/` | Sample entities |

## Notes

* **Pinned to 1.10, not 2.x.** RHDH 2.x images are published only to `quay.io/rhdh` and not to `registry.redhat.io`, so the operator pod fails with `manifest unknown`. Redirecting them needs an `ImageDigestMirrorSet`, which ROSA HCP does not permit. 1.10 is not missing anything required here -- its `lightspeed` flavour already provides the MCP tool runtime and `mcp_servers` block.
* **`catalog/org.yaml` is the access list, and nothing else is.** GitHub will authenticate anyone on the internet with an account; `usernameMatchingUserEntityName` is what turns that into a closed list. Adding a person is one `User` entity. Never set `dangerouslyAllowSignInWithoutUserInCatalog` with a public identity provider -- behind a corporate IdP that flag is defensible, here it would make the instance world-open.
* **`User` must be in the catalog `rules` allow list.** It is easy to miss, and the failure is quiet: `org.yaml` also contains Groups, so with `User` omitted the Groups load, the file looks fine, and the only thing dropped is the entity that gates access. Sign-in then fails with `unable to resolve user identity` and nothing appears in the logs.
* **Plugins from other demos are composed in, not listed here.** The dynamic-plugin installer is an init container and raises on an image it cannot pull, so a plugin listed here that the deployer has never built does not degrade Developer Hub - it stops the pod starting at all, with `Init:Error`. Each plugin demo owns its own `rhdh/dynamic-plugins-entry.yaml`; `scripts/compose-dynamic-plugins.py` stitches them in. With no arguments it reproduces `app-config/dynamic-plugins.yaml` byte for byte, so this demo stands alone.
* **`auth.session.secret` is mandatory for GitHub auth.** Without it sign-in fails *after* the GitHub callback, which reads like a bad callback URL and is not.
* **A rollout restart does not refresh the catalog.** Entities live in PostgreSQL and outlive the pod, so a restart re-reads nothing. `POST /api/catalog/refresh` on the `Location` does not reach `org.yaml` either, because that file is a *target* of `all.yaml` rather than a `Location` in its own right - the refresh stops at the parent and the new `User` never appears. Refresh an entity the file already manages instead, such as an existing user, and the whole file is re-read. Everything returns 200 throughout, so the only symptom is that the person still cannot sign in.
* **A private GitHub App 404s for everyone but its owner.** Only the owning account can authorize a private App, so a second person gets a 404 at `github.com/login/oauth/authorize` -- not a permission error, and nothing in the RHDH logs, because the request never reaches RHDH. It reads like a dead callback URL. The owner's own sign-in keeps working throughout, so this only ever surfaces when someone else tries.
* **The visibility switch moves once the App exists.** *Where can this GitHub App be installed?* is on the registration form and nowhere else; afterwards it is **Advanced -> Danger zone -> Make public**, which is not where you go looking for an install setting. Making the App public does not widen who can use this instance -- it lets anyone *start* the OAuth flow, and `catalog/org.yaml` still decides who finishes it.
* **An org-owned App can stay private and still admit other people**, because members of the owning organization may authorize it. A personal-account App has no such middle ground: it is you, or it is public. Transferring the App to an organization and adding the person there is the alternative if public is unacceptable.
* **There is no OpenShift auth provider in RHDH 1.10.** The upstream Backstage one needs `@backstage/backend-plugin-api` `^1.10.1`; RHDH 1.10 ships 1.8.0 and 2.1 ships 1.10.0. The cluster's own OAuth server is not OIDC either -- its `scopes_supported` has no `openid` -- so the `oidc` provider cannot stand in. Revisit when a release bundles it.
* **The GitHub Scaffolder module is enabled but unused.** RHDH preinstalls `backstage-plugin-scaffolder-backend-module-github` disabled; without the `disabled: false` entry in `dynamic-plugins.yaml`, a template that publishes fails with `Template action with ID 'publish:github:pull-request' is not registered`. Enabling it takes the registered action count from 17 to 30. It is on here so the publishing path works the moment auth is in place.
* **Do not use a `/` in a branch name set as `CATALOG_BRANCH`.** Backstage parses the ref in `/blob/<ref>/<path>` as a single path segment, so `feat/my-branch` resolves as ref `feat` with the remainder read as a directory. Use `feat-my-branch`. `main` is unaffected.
* `CATALOG_BRANCH` lets you verify catalog changes on a branch before merging without editing `app-config-rhdh.yaml`:
  ```bash
  oc -n rhdh patch secret rhdh-secrets -p '{"stringData":{"CATALOG_BRANCH":"feat-my-branch"}}'
  oc -n rhdh rollout restart deployment/backstage-developer-hub
  ```
* The operator names both the Deployment and the Route `backstage-<cr-name>`.
* The CR uses `rhdh.redhat.com/v1alpha5`. The 1.10.5 CRD serves `v1alpha4` and `v1alpha5`; `v1alpha5` is the storage version and the one carrying `spec.flavours`.
* The operator enables the `lightspeed` flavour by default, adding an `init-rag-data` init container and a `lightspeed-core` sidecar. `backstage.yaml` disables it so this demo is plain RHDH.
* `enableLocalDb: true` means the operator runs PostgreSQL. Use an external database for anything persistent.
* **The Route's 30s default timeout is shorter than a reasoning model's reply.** Without `haproxy.router.openshift.io/timeout`, haproxy cuts the connection first and the browser gets a bare 504 with no JSON body and nothing in the backend log -- which looks like an application bug and is not. The RHDH operator does not manage Route annotations, so setting it by hand holds.
* **`CATALOG_BRANCH` and sign-in are coupled.** The access list is read from git, so pointing `CATALOG_BRANCH` at a branch whose `org.yaml` lacks your `User` entity locks you out. Check before switching branches.

## Related Demos

* **[Deployment Planner](../demo-rhdh-cluster-planner)** -- a self-service wizard that compares a shared namespace, a dedicated ARO cluster and on-premises, and runs as a plugin inside this RHDH instance.

## Clean Up

```bash
oc delete -f backstage.yaml
oc delete -f app-config/dynamic-plugins.yaml -f app-config/app-config-rhdh.yaml
oc -n rhdh delete secret rhdh-secrets
oc delete -f operator/subscription.yaml
oc delete namespace rhdh
```
