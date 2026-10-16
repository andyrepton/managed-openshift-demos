# Custom Universal Developer Image for Dev Spaces

Build a Dev Spaces workspace image with newer language runtimes than the
shipped Universal Developer Image (UDI) carries, and make it the cluster
default.

The UDI tracks RHEL 9, so its runtimes lag:

| Tool | Shipped UDI | This image |
|:---|:---|:---|
| Python | 3.9.25 | **3.14.8** |
| Node | 22.23.2 | **24.22.0** |
| .NET SDK | 8.0.131 | **10.0.112** |

Java 17, Go, Maven, Git, podman and the rest are inherited unchanged.

## Prerequisites

- [`openshift-devspaces/`](../openshift-devspaces/) deployed (operator + CheCluster)
- `oc` CLI logged in as cluster-admin

## Why a custom image at all

There is no newer base to switch to. The community image
(`quay.io/devfile/universal-developer-image:ubi9-latest`) carries the same
Python 3.9.25 / Node 22 / .NET 8, and neither image ships `nvm`, `pyenv` or
`sdkman`. Installing at workspace start is not an option either: the
container runs as an arbitrary non-root UID, so `dnf install` fails, and
user-local installs would add several hundred MB to every workspace start.

Python 3.14 and .NET 10 are already packaged for RHEL 9.8. Node 24 is not —
the module stream stops at 22 — so it comes from nodejs.org.

## Setup

### 1. Build the image

The build pulls `FROM registry.redhat.io`, and **builds do not inherit the
cluster's global pull secret**. Copy it into the build namespace first:

```bash
oc apply -f buildconfig.yaml

oc get secret/pull-secret -n openshift-config \
  -o jsonpath='{.data.\.dockerconfigjson}' | base64 -d > /tmp/pull.json
oc create secret generic redhat-registry -n custom-udi \
  --from-file=.dockerconfigjson=/tmp/pull.json \
  --type=kubernetes.io/dockerconfigjson
oc secrets link builder redhat-registry -n custom-udi --for=pull
rm -f /tmp/pull.json

oc start-build custom-udi -n custom-udi --follow
```

### 2. Let workspaces pull it

Workspaces run in per-user namespaces and cannot pull from another
namespace's image stream by default:

```bash
oc policy add-role-to-group system:image-puller system:authenticated -n custom-udi
```

### 3. Make it the default

```bash
oc patch checluster devspaces -n openshift-operators --type=merge \
  --patch-file checluster-patch.yaml
```

This covers workspaces created without their own devfile. **A devfile that
names its own container image still wins** — that is by design, so update any
devfile you want on the new image.

### 4. Verify

Start a **new** workspace, then in its terminal:

```bash
python3 --version   # 3.14.8
node --version      # v24.22.0
dotnet --version    # 10.0.112
```

## Writing a custom UDI: what actually matters

Most of this is not obvious, and getting it wrong fails quietly.

### Never install into `/home/user`

With `persistUserHome` enabled — check with
`oc get checluster devspaces -n openshift-operators -o jsonpath='{.spec.devEnvironments.persistUserHome}'` —
a PVC is mounted over `/home/user`, **replacing whatever the image put
there**. A binary installed to `/home/user/bin` at build time simply
disappears on first start.

Install to `/opt` or `/usr` instead. Both are outside the persisted volume.

If you do need content in the home directory, stage it in `/home/tooling` and
link it:

```dockerfile
RUN stow -t /home/user/ -d /home/tooling/ --no-folding
```

This needs `stow >= 2.4.0` and `HOME=/home/user`. For files users edit in
place (`.bashrc`, `.viminfo`), list them in `/home/tooling/.copy-files` so
they are copied rather than symlinked.

### `stow` runs once per PVC, not per image

An `init-persistent-home` init container stows the first time a volume is
mounted. **Rebuilding the image does not re-stow an existing workspace.**
After changing the image, delete the workspace *and its PVC* — reopening a
stopped workspace keeps the old contents. Check `/home/user/.stow.log` when
debugging a tool that "vanished".

### `/usr/local/bin` is not on the PATH

The UDI sets its PATH explicitly, and `/usr/local/bin` is absent:

```
/home/user/.local/bin:/home/user/bin:/usr/share/Modules/bin:...:/usr/bin:...
```

Symlinks there are silently ignored. Editing a shell profile does not work
either, because those files live in the persisted home. Replacing the entries
in `/usr/bin` is the only reliable option.

### Repointing `python3` is safe, but check first

`dnf` pins `#!/usr/bin/python3.9`, so it keeps working when `/usr/bin/python3`
moves to 3.14 — verified, `dnf --version` still responds. A few unrelated RHEL
tools (`cockpit-bridge`, `udica`, flatpak helpers) do follow the symlink and
are untested on 3.14; none is used in a workspace.

Note that `pip3` resolves to a pre-existing `/home/user/.local/bin/pip3` tied
to the old interpreter, and that path comes from the PVC so the image cannot
fix it. Use `python3 -m pip` or `pip3.14`.

### Arbitrary UID

OpenShift assigns a random UID with supplemental group 0, and the workspace
user cannot `chgrp` anything themselves. Permissions must be baked in:

```dockerfile
RUN chgrp -R 0 /home /opt/node && chmod -R g=u /home /opt/node
```

### Keep `openssl` and `libbrotli`

Code - OSS will not start without them. They come from the base image; do not
remove them while slimming an image down.

### Use `.tar.gz`, not `.tar.xz`

The base image has no `xz` binary, so an `xz` tarball fails to extract mid
build. Either use the gzip tarball or install `xz` first.

## Cleanup

```bash
oc patch checluster devspaces -n openshift-operators --type=json \
  -p '[{"op":"remove","path":"/spec/devEnvironments/defaultComponents"}]'
oc delete -f buildconfig.yaml
```

Existing workspaces keep running on the old image until they are deleted and
recreated.
