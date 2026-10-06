# OpenShift Dev Spaces

Browser-based cloud development environment powered by Eclipse Che.
Provides on-demand, pre-configured workspaces that run entirely on the
cluster — no local IDE setup required.

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
https://<devspaces-url>/f?url=<git-repo-url>
```

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
