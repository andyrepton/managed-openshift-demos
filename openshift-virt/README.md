# OpenShift Virtualization

This folder installs OpenShift Virtualization on a managed OpenShift cluster
from the command line: it creates the namespace, OperatorGroup and
Subscription, then a default HyperConverged resource that turns the feature on.
The cluster can then run virtual machines alongside containers, so existing VM
workloads can move onto the same platform. On Red Hat OpenShift Service on AWS
(ROSA) it needs a bare-metal machine pool. It is here as the base for the repo's
virtualization demos.

Tested: 2026-11-05, ROSA HCP 4.22.12, OpenShift Virtualization 4.22.12, one m5.metal node.

## Prerequisites

* A ROSA cluster with a bare-metal worker: apply
  [andys-demo-cluster-tf](../andys-demo-cluster-tf) with
  `deploy_virt_machine_pool = true` (one `m5.metal` node, labelled
  `node_type=metal`). A metal node takes 15 minutes or more to join.
* `oc` CLI with cluster-admin access.

OpenShift Virtualization does not yet work on ARO.

## Setup

Run these from this folder.

### 1. Install the operator

```bash
oc apply -f namespace.yaml -f operator-group.yaml -f subscription.yaml
until oc get csv -n openshift-cnv 2>/dev/null | grep kubevirt-hyperconverged | grep -q Succeeded; do sleep 10; done
```

### 2. Turn on virtualization

The `HyperConverged` resource can only be created once the operator has
installed its CRD, which is why it is a separate step:

```bash
oc apply -f hyperconverged.yaml
oc wait hyperconverged/kubevirt-hyperconverged -n openshift-cnv --for=condition=Available --timeout=20m
```

### 3. Verify

The metal node is Ready, and it is the only node that offers KVM to virtual
machines (OpenShift Virtualization runs on every worker, but only bare metal
has `/dev/kvm`):

```bash
oc get nodes -l node_type=metal
oc get nodes -o custom-columns='NAME:.metadata.name,TYPE:.metadata.labels.node\.kubernetes\.io/instance-type,KVM:.status.allocatable.devices\.kubevirt\.io/kvm'
```

The metal node shows `1k` in the `KVM` column and every other node `0`. This
can take a minute or two after the node joins. **Virtualization** then appears
in the console's navigation.

## Clean Up

Delete every virtual machine first, then:

```bash
oc delete -f hyperconverged.yaml
oc wait --for=delete hyperconverged/kubevirt-hyperconverged -n openshift-cnv --timeout=10m
oc delete subscription hco-operatorhub -n openshift-cnv
oc delete csv -n openshift-cnv \
  "$(oc get csv -n openshift-cnv -o name | grep kubevirt-hyperconverged | cut -d/ -f2)"
oc delete -f operator-group.yaml -f namespace.yaml
```
