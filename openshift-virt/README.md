# OpenShift Virtualization

This folder installs OpenShift Virtualization on a managed OpenShift cluster
from the command line: one `oc apply` creates the namespace, OperatorGroup and
Subscription and a default HyperConverged resource that turns the feature on.
The cluster can then run virtual machines alongside containers, so existing VM
workloads can move onto the same platform. On Red Hat OpenShift Service on AWS
(ROSA) it needs a bare-metal machine pool. It is here as the base for the repo's
virtualization demos.

## Deploying OpenShift Virtualization  onto a Managed OpenShift Cluster using the command line

### Option 1: Manually

```bash
oc apply -f .
```
OpenShift Virt will be installed in the openshift-cnv namespace

> Important: you will need to add an appropriate node to ROSA in order for this to work (AKA a Metal node).

> Note: OpenShift virt does not yet work on ARO
