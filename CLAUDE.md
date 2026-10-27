# Repository rules

## Writing style

**Do not use em dashes (`—`) in any file in this repository.** This covers READMEs,
demo documentation, YAML comments, commit messages and PR descriptions.

Use a comma, a colon, parentheses, or split the sentence in two instead:

| Instead of | Write |
|:---|:---|
| `BGP gets the prefixes into the VPC — nothing else follows` | `BGP gets the prefixes into the VPC. Nothing else follows.` |
| `two IPs — one routable, one locked` | `two IPs: one routable, one locked` |
| `the operator creates it — named cluster-udn-<name>` | `the operator creates it (named cluster-udn-<name>)` |

**Why:** demos from this repo get ported to the team documentation site at
<https://cloud.redhat.com/experts/> ([rh-mobb/documentation](https://github.com/rh-mobb/documentation)),
which bans em dashes in site content. Keeping the two in sync removes a whole
class of rewriting from every port.

En dashes (`–`) and hyphens (`-`) are fine.

## Adding to CLAUDE.md or memory

**Check with the user before adding anything new to a `CLAUDE.md` file or to
agent memory.** Propose the entry (what it says and which file it goes in) and
wait for a yes. Suggesting an entry is encouraged; writing one unasked is not.

Demos here are torn down and rebuilt often, so suggest an entry whenever a
common issue turns up, or the user says it has been fixed before ("like
usual", "as always"). Check the existing `CLAUDE.md` files and memory first,
since a missing entry is the usual reason the same fix gets worked out twice.

Put a lesson in the `CLAUDE.md` of the folder it applies to. Use this root file
only for rules that apply across the repo.

## Working on demos

### Verify before assuming

Check a load-bearing fact against the live system (the cluster, the registry,
the API, the CRD schema) before asserting it or acting on it. Prefer that over
secondary signals such as git branches, package registries or web search. If
you cannot check, say it is an assumption and let the user decide. Never blur
verified and assumed.

For Red Hat products, read the official docs for the **exact deployed version**
before writing config. "Not in the image I inspected" is not the same as "does
not exist": say which one you mean.

### Follow the README exactly

When deploying a demo, follow its README step by step, including the verify
steps. Do not invent install steps, skip steps, or substitute an "equivalent"
check of your own.

If a step conflicts with another rule (for example a verify step that deletes a
pod), fails, is a no-op, or contradicts another README, **stop and ask**. Then
fix the README so the next run does not hit it.

When a README lists other demos as prerequisites, check their `CLAUDE.md` files
for patterns already found working *between* them (ports, endpoints, image
choices, sizing, ordering) before starting.

### Composable demos

A demo that combines capabilities lists the existing demos as prerequisites and
contains only the new glue. Do not copy another demo's operator subscriptions or
base setup.

### Test before commit

Test every change end to end on a real cluster before committing it, README
changes that reference commands included.

- **Test as the identity that will really do it.** A check that passes as
  cluster-admin proves nothing about a ServiceAccount. Impersonate (`--as=`) or
  use the real token.
- **Test to the end state the user sees.** A `Running` pod is not a working
  workspace. Assert on the thing the user is waiting for.
- After a fix, replay the **original** failing scenario, not a simplified one.

If something genuinely cannot be tested before it is pushed (for example a
Dev Spaces factory URL reads its devfile from GitHub), push to a feature branch,
test from there, and say which rule is being bent and why.

### Ask before anything destructive

Ask the user, every time, before any command that can delete, overwrite or
discard files, data or resources. Approval of a surrounding task does not cover
it. This includes `rm`, `git reset --hard`, `git checkout -- <path>`,
`git clean`, `git stash`, `git branch -D`, any force push, `oc delete`,
`helm uninstall`, `terraform destroy`, any `terraform apply` whose plan shows
destroys, and overwriting an existing file. Never hide a destructive command in
a `&&` / `||` chain where it can fire as a fallback.

**Destroying a cluster always needs explicit confirmation for that specific
cluster**, including indirect destruction such as a tfvars change that forces a
recreate.

### Settings whose name is a warning

Stop and ask before setting anything named `dangerously*`, `unsafe*`,
`insecure*`, `*SkipTLSVerify`, `skip*Validation`, `allowAll*`, `privileged`,
`--force`, `bypass*` and similar. Say what it disables and what becomes
reachable. If approved, record why next to it in the file. Re-examine every
accepted risk when the stakes change (a new credential, a public Route, real
data).

### Secrets

Never put real API keys, passwords or tokens in a tracked file. Use environment
variable references or Secret templates with `REPLACE_ME` placeholders. Never
pass a token as a command-line flag where an environment variable works, since
flags show up in process listings. Never write the local path of a credential
file into the repo.

Terraform here initialises every cloud provider unconditionally. Provider auth
errors mean credentials were not exported, not that the code is wrong; do not
work around them with dummy values.

### Infrastructure

Create and change infrastructure through Terraform, never by hand (no
`rosa create machinepool`). When a resource fails, fix the Terraform and
re-apply. The one exception is an orphaned resource a managed service left
behind outside Terraform state: see `andys-demo-cluster-tf/CLAUDE.md`.

### Dev Spaces factory URLs

Use the `#` form, with parameters on the git URL:

```
https://<devspaces-url>#https://github.com/<org>/<repo>?devfilePath=<path>
```

The `/f?url=` form is outdated.

## Git and pull requests

- Pull `main`, branch from it, work on the branch. After the PR merges, pull
  `main` again before starting anything else.
- Never push to `main` or force-push without the user's approval at that moment.
  Feature branches are fine.
- One PR, one topic (unless the user asks otherwise). Stage explicit paths,
  never `git add -A` or `git add .`, and check the untracked list for files
  that predate the task.
- PR descriptions and commit messages state what the change does and why. No
  discovery narrative or self-commentary: the repo is public.
