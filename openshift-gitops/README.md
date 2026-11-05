# OpenShift GitOps

This folder installs the Red Hat OpenShift GitOps operator (based on Argo CD)
from the `redhat-operators` catalog and gives the default Argo CD application
controller cluster-admin rights, so Argo CD can manage resources across the
whole cluster. It lets cluster configuration and applications be declared in Git
and reconciled automatically. It is here as a building block for GitOps-driven
demos such as `demo-deploying-segregated-gitops`.

Tested: 2026-11-05, ROSA HCP 4.22.12, OpenShift GitOps 1.22.3.

## Prerequisites

* A managed OpenShift cluster (ROSA, ARO or OSD).
* `oc` CLI with cluster-admin access.

## Setup

From this folder, install the operator and the cluster-admin binding, then wait
for the operator and the default Argo CD instance it creates:

```bash
oc apply -f .

until oc get csv -n openshift-operators 2>/dev/null | grep openshift-gitops-operator | grep -q Succeeded; do sleep 10; done
until oc get argocd openshift-gitops -n openshift-gitops >/dev/null 2>&1; do sleep 5; done
oc wait argocd/openshift-gitops -n openshift-gitops --for=jsonpath='{.status.phase}'=Available --timeout=5m
```

The cluster-admin binding (`gitops-cluster-admin-binding`) is what lets this
Argo CD create projects, RoleBindings and other Argo CD instances for teams.
Anyone who can merge into a repository it syncs can change anything on the
cluster, so keep its Applications pointed at repositories the platform team
controls.

## Verify

```bash
oc get route openshift-gitops-server -n openshift-gitops -o jsonpath='https://{.spec.host}{"\n"}'
```

Open the URL and log in with OpenShift.

## Clean Up

```bash
oc delete clusterrolebinding gitops-cluster-admin-binding
oc delete subscription openshift-gitops-operator -n openshift-operators
oc delete csv -n openshift-operators \
  "$(oc get csv -n openshift-operators -o name | grep openshift-gitops-operator | cut -d/ -f2)"
```
