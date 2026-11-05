# Multi-Cloud VM Migration with MTV

This demo prepares the source side of a virtual machine migration between two
OpenShift clusters with the Migration Toolkit for Virtualization (MTV). It runs
a Fedora VM with a small web dashboard on OpenShift Virtualization and creates a
ServiceAccount, scoped to migration, whose token the destination cluster uses to
register this cluster as an MTV source. It is here to show VMs moving between
OpenShift clusters, for example across clouds, with the same tooling at both
ends.

Tested: 2026-11-05, ROSA HCP 4.22.12, OpenShift Virtualization 4.22.12: source side, steps 1-4. Step 5 needs a destination cluster with MTV and was not run.

## Overview

* **Fedora 42 VM** (`vm.yaml`, `my-multicloud-vm`): a VirtualMachine with
  cloud-init (`vm-secret.yaml`) that serves an httpd dashboard showing ISP,
  IP and resource metrics.
* **DataVolume** (`datavolume.yaml`, `demo-datavolume`): imports the
  `fedora-httpd-multicloud:v5.3` image from `quay.io` (7Gi disk).
* **Migration ClusterRole** (`role.yaml`): the Forklift, KubeVirt, CDI and
  batch permissions the destination cluster's MTV needs on this cluster.
* **ServiceAccount** (`sa.yaml`, `sa-token.yaml`): an `mtv` ServiceAccount with
  a long-lived token, which the destination cluster uses to connect.

Everything is created in the `default` namespace.

## Prerequisites

* This (source) cluster with OpenShift Virtualization installed (see
  [../openshift-virt](../openshift-virt)).
* A destination OpenShift cluster with OpenShift Virtualization and the
  Migration Toolkit for Virtualization (MTV) installed.
* `oc` CLI with cluster-admin access on the source cluster.

## How to Run the Demo

Run these from this folder, on the source cluster.

### 1. Apply all manifests

```bash
oc apply -f sa.yaml
oc apply -f .
```

This creates the VM, DataVolume, ClusterRole, ServiceAccount, token Secret and
the VM's cloud-init Secret. The ServiceAccount goes first on its own: `oc
apply -f .` works alphabetically, and a token Secret created before its
ServiceAccount exists is deleted straight away, so `mtv-token` would never
appear.

### 2. Wait for the VM to start

The DataVolume must finish importing before the VM can boot (a few minutes):

```bash
oc wait datavolume/demo-datavolume -n default --for=condition=Ready --timeout=15m
oc wait vm/my-multicloud-vm -n default --for=condition=Ready --timeout=10m
oc get vm my-multicloud-vm -n default
```

The VM shows `Running` and `Ready` is `True`.

### 3. Create the ClusterRoleBinding

```bash
oc create clusterrolebinding mtv-migration-binding \
  --clusterrole=mtv-migration-role \
  --serviceaccount=default:mtv
```

### 4. Get the API URL and the ServiceAccount token

The destination cluster needs both. The token grants the permissions in
`role.yaml` across this cluster, so treat it as a secret:

```bash
oc whoami --show-server
oc get secret mtv-token -n default -o jsonpath='{.data.token}' | base64 -d; echo
```

### 5. Configure MTV on the destination cluster

On the destination cluster, open the OpenShift console and go to **Migration >
Providers**. Add an **OpenShift Virtualization** provider
with the source cluster's API URL and the token from step 4, then create a
migration plan for `my-multicloud-vm`.

## Clean Up

```bash
oc delete clusterrolebinding mtv-migration-binding
oc delete -f .
```
