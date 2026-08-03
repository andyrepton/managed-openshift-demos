# OpenShift Virtualization on OpenShift Dedicated (GCP)

This demo deploys OpenShift Virtualization on an OpenShift Dedicated cluster running on Google Cloud Platform, using bare-metal instance types (`c3-standard-192-metal`) for full nested virtualization support.

## Overview

* **Bare-Metal MachineSet** (`virt-machine-set.yaml`) -- Provisions GCP `c3-standard-192-metal` workers with `hyperdisk-balanced` storage and a `metal` taint to isolate virtualization workloads.
* **HyperConverged CR** (`hyperconverged.yaml`) -- Configures OpenShift Virtualization with node affinity and tolerations targeting the bare-metal nodes.
* **StorageProfile** (`storageprofile.yaml`) -- Defines a `hyperdisk` storage profile with 4Gi minimum PVC size for VM disks.

## Prerequisites

* An OpenShift Dedicated cluster on GCP.
* OpenShift Virtualization operator installed (see `../openshift-virt`).
* `oc` CLI with cluster-admin access.

## How to Run the Demo

### 1. Customize the MachineSet

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
