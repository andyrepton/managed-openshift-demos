# Multi-Cloud VM Migration with MTV

This demo prepares the source side of a virtual machine migration between two
OpenShift clusters with the Migration Toolkit for Virtualization (MTV). It runs
a Fedora VM with a small web dashboard on OpenShift Virtualization and creates a
ServiceAccount, scoped to migration, whose token the destination cluster uses to
register this cluster as an MTV source. It is here to show VMs moving between
OpenShift clusters, for example across clouds, with the same tooling at both
ends.

## Overview

* **Fedora 42 VM** (`vm.yaml`) -- A VirtualMachine with cloud-init that installs and configures an httpd dashboard showing ISP, IP, and resource metrics.
* **DataVolume** (`datavolume.yaml`) -- Pulls the `fedora-httpd-multicloud:v5.3` image from `quay.io` (7Gi disk).
* **Migration ClusterRole** (`role.yaml`) -- Grants permissions for Forklift, KubeVirt, CDI, and batch API resources required for VM migration.
* **Service Account** (`sa.yaml`, `sa-token.yaml`) -- Creates an `mtv` service account with a long-lived token for authenticating from the remote cluster.

## Prerequisites

* Two OpenShift clusters, each with OpenShift Virtualization and MTV (Forklift) installed.
* `oc` CLI with cluster-admin access on the source cluster.

## How to Run the Demo

### 1. Create the Service Account

```bash
oc create sa mtv
```

### 2. Apply All Manifests

```bash
oc apply -f .
```

This creates the VM, DataVolume, ClusterRole, ServiceAccount, token secret, and VM credentials secret.

### 3. Wait for the VM to Start

The DataVolume must finish importing before the VM can boot:

```bash
oc get datavolume fedora-httpd -w
oc get vm fedora-httpd
```

### 4. Extract the Service Account Token

```bash
oc get secret mtv-token -o jsonpath='{.data.token}' | base64 --decode
```

Save this token -- it will be used to configure the MTV Provider on the destination cluster.

### 5. Create the ClusterRoleBinding

```bash
oc create clusterrolebinding mtv-migration-binding \
  --clusterrole=mtv-migration-role \
  --serviceaccount=default:mtv
```

### 6. Configure MTV on the Destination Cluster

On the destination cluster, open the OpenShift console and navigate to **Migration > Providers**. Add a new OpenShift Virtualization provider using the source cluster's API URL and the service account token from step 4.

## Clean Up

```bash
oc delete vm fedora-httpd
oc delete datavolume fedora-httpd
oc delete clusterrolebinding mtv-migration-binding
oc delete clusterrole mtv-migration-role
oc delete secret mtv-token vm-secret
oc delete sa mtv
```
