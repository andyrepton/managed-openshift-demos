# Deploying a VM with OpenShift Virtualization

This presenter-led demo creates and manages a virtual machine on a managed
OpenShift cluster (ROSA, ARO or OSD) with OpenShift Virtualization, which runs
VMs as native Kubernetes workloads next to containers. Everything happens in the
OpenShift web console: create a VM from a template, open its console, watch its
resource use, and show live migration, snapshots or pause and resume. It is here
to show that teams can run existing VM workloads and containers on one managed
platform with one set of tools. It needs metal-capable workers and the operator
from `openshift-virt`.

## Overview

* **OpenShift Virtualization** -- Runs VMs as native Kubernetes workloads alongside containers.
* **Console-driven workflow** -- VM creation, management, and monitoring through the OpenShift web console.
* **Presenter format** -- Separate preparation (`before-your-demo.md`) and cleanup steps to ensure a clean demo environment.

## Prerequisites

* A ROSA, ARO, or OSD cluster with bare-metal or metal-capable worker nodes.
* OpenShift Virtualization operator installed (see `../openshift-virt` for installation steps).
* `oc` CLI with cluster-admin access.
* OpenShift Dev Spaces installed if combining with the S2I portion of the demo (see `../openshift-devspaces`).

## How to Run the Demo

### 1. Prepare the Environment

Follow the steps in `before-your-demo.md`:

* Ensure OpenShift Virtualization is installed and the `HyperConverged` CR is deployed.
* Clean up any leftover resources from previous demos:

```bash
oc project s2i-demo
oc delete buildconfig demo
oc delete deployment demo
oc delete imagestream demo
oc delete service demo
oc delete route demo
oc delete project s2i-demo
```

* Pre-warm Dev Spaces by creating and then deleting a workspace with `https://github.com/andyrepton/hello`.

### 2. Create a Virtual Machine

Open the OpenShift console and navigate to **Virtualization > Virtual Machines > Create VirtualMachine**. Select a template (e.g., Fedora, RHEL) and follow the wizard.

### 3. Explore the VM

* Access the VM console via the **Console** tab.
* Monitor resource usage in the **Overview** tab.
* Demonstrate live migration, snapshots, or pause/resume as needed.

## Clean Up

Delete the virtual machine through the OpenShift console or via CLI:

```bash
oc delete vm <vm-name> -n <namespace>
```

## Related Demos

* [OpenShift Virt on OSD (GCP)](../demo-openshift-virt-on-osd) -- Provisioning bare-metal nodes for virtualization on GCP.
* [Multi-Cloud VM Migration (MTV)](../demo-mtv-migration-multi-cloud) -- Migrating VMs between clusters.
