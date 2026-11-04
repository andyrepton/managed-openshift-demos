# OpenShift GitOps

This folder installs the Red Hat OpenShift GitOps operator (based on Argo CD)
from the `redhat-operators` catalog and gives the default Argo CD application
controller cluster-admin rights, so Argo CD can manage resources across the
whole cluster. It lets cluster configuration and applications be declared in Git
and reconciled automatically. It is here as a building block for GitOps-driven
demos such as `demo-deploying-segregated-gitops`.

##### 2.1.2 GitOps

```bash
oc apply -f .
```
