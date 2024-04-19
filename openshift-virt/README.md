## Deploying OpenShift Virtualization  onto a Managed OpenShift Cluster using the command line

### Option 1: Manually

```bash
oc apply -f .
```
OpenShift Virt will be installed in the openshift-cnv namespace

> Important: you will need to add an appropriate node to ROSA in order for this to work (AKA a Metal node).

> Note: OpenShift virt does not yet work on ARO
