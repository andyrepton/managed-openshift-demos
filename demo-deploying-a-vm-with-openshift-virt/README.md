# Deploying a VM with OpenShift Virtualization

This presenter-led demo creates and manages a virtual machine on a managed
OpenShift cluster (ROSA, ARO or OSD) with OpenShift Virtualization, which runs
VMs as native Kubernetes workloads next to containers. In the OpenShift web
console you create a VM from a template, open its console, watch its resource
use, and show snapshots or pause and resume; the same VM can also be created
and checked from the command line. It is here to show that teams can run
existing VM workloads and containers on one managed platform with one set of
tools. It needs metal-capable workers and the operator from `openshift-virt`.

Tested: 2026-11-05, ROSA HCP 4.22.12, OpenShift Virtualization 4.22.12: the command-line path. The console steps were not run.

## Overview

* **OpenShift Virtualization**: runs VMs as native Kubernetes workloads
  alongside containers.
* **Console-driven workflow**: VM creation, management and monitoring through
  the OpenShift web console.
* **Command-line path**: `vm.yaml` and `snapshot.yaml` do the same with `oc`,
  for rehearsal or when there is no browser.
* **Presenter format**: preparation in `before-your-demo.md`, cleanup at the
  end of this file.

## Prerequisites

* A ROSA, ARO or OSD cluster with bare-metal or metal-capable worker nodes.
* OpenShift Virtualization installed (see [../openshift-virt](../openshift-virt)).
* `oc` CLI with cluster-admin access.

## How to Run the Demo

### 1. Prepare the environment

Follow [before-your-demo.md](before-your-demo.md).

### 2. Create a virtual machine

In the console, go to **Virtualization > VirtualMachines > Create
VirtualMachine**, pick the **Fedora** template (or a RHEL one) and follow the
wizard.

### 3. Explore the VM

* Open the VM's console from the **Console** tab.
* Show resource use on the **Overview** tab.
* Take a snapshot from the **Snapshots** tab, and pause and resume the VM from
  the **Actions** menu.

Live migration needs a second metal node and ReadWriteMany storage. The default
EBS `gp3-csi` storage on ROSA is ReadWriteOnce only, so live migration is not
part of this setup (one metal node, EBS storage).

### Command-line path

Run these from this folder. The VM uses the same Fedora golden image and the
`u1.small` instance type (1 vCPU, 2 GiB). The first boot takes about ten
minutes, most of it cloning the 30 GiB disk:

```bash
oc apply -f vm.yaml
oc wait vm/fedora-demo -n vm-demo --for=condition=Ready --timeout=20m
oc wait vmi/fedora-demo -n vm-demo --for=condition=AgentConnected --timeout=10m
oc get vmi fedora-demo -n vm-demo -o wide
```

`AgentConnected` means the Fedora guest has booted and its guest agent is
talking to OpenShift. The last command shows the VM running on the metal node.

Take a snapshot of the running VM (a few minutes, while EBS copies the disk):

```bash
oc apply -f snapshot.yaml
oc wait vmsnapshot/fedora-demo-snap-1 -n vm-demo --for=condition=Ready --timeout=10m
oc get vmsnapshot -n vm-demo
```

The snapshot shows `Succeeded` and `READYTOUSE` is `true`.

## Clean Up

For a VM made in the console, delete it from its **Actions** menu (or
`oc delete vm <vm-name> -n <namespace>`). For the command-line path:

```bash
oc delete -f snapshot.yaml
oc delete -f vm.yaml
```

Deleting the namespace removes the VM, its disk and its snapshot.

## Related Demos

* [OpenShift Virt on OSD (GCP)](../demo-openshift-virt-on-osd): provisioning
  bare-metal nodes for virtualization on GCP.
* [Multi-Cloud VM Migration (MTV)](../demo-mtv-migration-multi-cloud):
  migrating VMs between clusters.
