# OpenShift Dev Spaces

This folder installs Red Hat OpenShift Dev Spaces, the browser-based development
environment built on Eclipse Che, on a managed OpenShift cluster such as ROSA or
ARO. Developers can then open ready-made workspaces for any Git repository from
the dashboard or from a factory URL pointing at a devfile, with nothing to set
up on their laptop. A GitOps install through OpenShift GitOps is included too.
It is here as the base for the repo's in-cluster development demos, such as
`demo-source2image`, `demo-custom-udi` and `demo-opencode-devspaces`.

## Prerequisites

* A managed OpenShift cluster (ROSA, ARO, or OCP).
* `oc` CLI with cluster-admin access.

## Setup

### 1. Install the Dev Spaces Operator

```bash
oc apply -f subscription.yaml

# Wait for the operator to install:
oc get csv -n openshift-operators -w | grep devspaces
```

### 2. Create the CheCluster

```bash
oc apply -f che-cluster.yaml
```

Wait for the CheCluster to become available (2-3 minutes):

```bash
oc get checluster devspaces -n openshift-operators -w
```

## Verify

```bash
# CheCluster should show Available status:
oc get checluster devspaces -n openshift-operators \
  -o jsonpath='{.status.chePhase}'

# Get the Dev Spaces dashboard URL:
oc get checluster devspaces -n openshift-operators \
  -o jsonpath='{.status.cheURL}'
```

Open the dashboard URL in a browser to confirm it loads.

## Opening a Workspace

From the Dev Spaces dashboard you can create workspaces from any Git
repository. You can also use a factory URL to open a workspace directly:

```
https://<devspaces-url>#<git-repo-url>
```

Parameters go on the git URL, after the `#`, for example
`#https://github.com/<org>/<repo>?devfilePath=<path>`.

## Alternative: GitOps

If you have OpenShift GitOps installed (see `../openshift-gitops/`):

```bash
oc apply -f gitops/application.yaml
```

## Clean Up

```bash
oc delete checluster devspaces -n openshift-operators
oc delete subscription devspaces -n openshift-operators
oc delete csv -n openshift-operators $(oc get csv -n openshift-operators -o name | grep devspaces)
```
