# Install RHACM

### Option 1: Manually

```bash
oc apply -f .
```

Wait for the CRD to be installed, then run again (first run will lack the multi-cluster-hub CRD)

### Option 2: GitOps

- Go to the gitops folder [here](../gitops) and install gitops
- Create the application file in the gitops folder:

```bash
oc apply -f gitops/
```
