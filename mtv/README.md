# Migration Toolkit for Virtualization (MTV)

This folder installs the Migration Toolkit for Virtualization (MTV) on an
OpenShift cluster from the command line: it creates the `openshift-mtv`
namespace, OperatorGroup and Subscription, then the `ForkliftController` that
deploys MTV's controllers and its console plugin. MTV moves virtual machines
onto OpenShift Virtualization from VMware, Red Hat Virtualization, OpenStack or
another OpenShift cluster, so workloads can move between clusters and clouds
with one tool. It is here as the base for the repo's VM migration demos.

## Prerequisites

* OpenShift Virtualization installed (see [../openshift-virt](../openshift-virt)).
* OpenShift 4.20, 4.21 or 4.22. The Subscription follows the `release-v2.12`
  channel, and MTV 2.12 supports exactly those versions.
* `oc` CLI with cluster-admin access.

For a migration between two OpenShift clusters, install MTV on both: MTV's
documentation asks for matching MTV versions on the source and destination.

## Setup

Run these from this folder.

### 1. Install the operator

```bash
oc apply -f namespace.yaml -f operator-group.yaml -f subscription.yaml
until oc get csv -n openshift-mtv 2>/dev/null | grep mtv-operator | grep -q Succeeded; do sleep 10; done
```

### 2. Deploy MTV

The `ForkliftController` can only be created once the operator has installed
its CRD, which is why it is a separate step:

```bash
oc apply -f forklift-controller.yaml
oc wait deployment --all -n openshift-mtv --for=condition=Available --timeout=10m
```

### 3. Verify

```bash
oc get pods -n openshift-mtv
oc get provider -n openshift-mtv
```

Every pod is `Running`, and MTV has created a `host` provider of type
`openshift` (the local cluster) with `READY` `True`. **Migration for
Virtualization** appears in the console's navigation after a browser refresh.

## Clean Up

Delete every migration plan, map and provider you created first, then:

```bash
oc delete -f forklift-controller.yaml
oc delete subscription mtv-operator -n openshift-mtv
oc delete csv -n openshift-mtv \
  "$(oc get csv -n openshift-mtv -o name | grep mtv-operator | cut -d/ -f2)"
oc delete -f operator-group.yaml -f namespace.yaml
```
