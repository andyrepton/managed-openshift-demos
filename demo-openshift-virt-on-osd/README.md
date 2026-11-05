# OpenShift Virtualization on OpenShift Dedicated (GCP)

This demo runs OpenShift Virtualization on Red Hat OpenShift Dedicated (OSD) on
Google Cloud. It adds bare-metal workers with hyperdisk storage, tainted so only
virtualization workloads land on them, pins OpenShift Virtualization to those
nodes, sets up hyperdisk for VM disks, and then creates a virtual machine from
the console or a manifest. It is here to show that a managed OpenShift cluster
on Google Cloud can run virtual machines next to containers on dedicated
bare-metal capacity. The operator comes from `openshift-virt`.

## Overview

* **Bare-Metal MachineSet** (`virt-machine-set.yaml`) -- Provisions GCP `c3-standard-192-metal` workers with `hyperdisk-balanced` storage and a `metal` taint to isolate virtualization workloads.
* **HyperConverged CR** (`hyperconverged.yaml`) -- Configures OpenShift Virtualization with node affinity and tolerations targeting the bare-metal nodes.
* **StorageProfile** (`storageprofile.yaml`) -- Defines a `hyperdisk` storage profile with 4Gi minimum PVC size for VM disks.

## Prerequisites

* An OpenShift Dedicated cluster on GCP.
* OpenShift Virtualization operator installed (see `../openshift-virt`).
* `oc` CLI with cluster-admin access.

## How to Run the Demo

### 1. Add the bare-metal workers

**Preferred, not yet tested:** [andys-demo-cluster-tf](../andys-demo-cluster-tf)
can add the bare-metal pool through OCM with `osd_deploy_virt_machine_pool = true`
(one `c3-standard-192-metal` node, labelled `node_type=metal`, tainted
`metal=true:NoSchedule`), instead of the hand-edited MachineSet below. This keeps
the infrastructure in Terraform. It has not been applied yet, and it does not set
the boot disk type, so check that OCM gives the metal node `hyperdisk-balanced`.

**Known blocker when rebuilding:** the OSD module names its GCP custom roles
from the first 8 characters of the cluster name without dashes, so `poc-andyr`,
`poc-andyr1` and `poc-andyr2` all become `pocandyr_*`. GCP will not reuse the ID
of a deleted custom role for about 37 days, so building an OSD cluster soon
after destroying one with the same prefix fails with `You can't create a role_id
... which has been marked for deletion`. Use a cluster name with a different
first 8 characters until that is fixed.

### 1a. Or customize the MachineSet

Edit `virt-machine-set.yaml` and replace the following cluster-specific values:

* `poc-andyr-4m8v8` -- Your cluster ID (appears in labels and tags)
* `poc-andyr-vpc` / `poc-andyr-worker-subnet` -- Your VPC and subnet names
* `mobb-demo` -- Your GCP project ID
* `europe-west4` / `europe-west4-c` -- Your region and zone
* `osd-worker-f58r@mobb-demo.iam.gserviceaccount.com` -- Your worker service account email

### 2. Deploy the Bare-Metal Workers

```bash
oc apply -f virt-machine-set.yaml
```

Wait for the machine to provision and the node to become `Ready`:

```bash
oc get machines -n openshift-machine-api -w
oc get nodes -l beta.kubernetes.io/instance-type=c3-standard-192-metal
```

### 3. Configure the Storage Profile

```bash
oc apply -f storageprofile.yaml
```

### 4. Deploy OpenShift Virtualization

```bash
oc apply -f hyperconverged.yaml
```

Wait for the HyperConverged resource to become available:

```bash
oc get hyperconverged kubevirt-hyperconverged -n openshift-cnv -o jsonpath='{.status.conditions}'
```

### 5. Create a Virtual Machine

Use the OpenShift console (**Virtualization > Virtual Machines > Create**) or apply a VM manifest to test the setup.

## Clean Up

```bash
oc delete -f hyperconverged.yaml
oc delete -f storageprofile.yaml
oc delete -f virt-machine-set.yaml
```

Wait for the bare-metal machine to be fully deprovisioned before considering the cleanup complete.
