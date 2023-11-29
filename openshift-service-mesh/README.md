# Install RHACM

### Option 1: Manually

```bash
oc apply -f .
```

### Option 2: GitOps

- Go to the gitops folder [here](../openshift-gitops) and install gitops
- Create the application file in the gitops folder:

```bash
oc apply -f gitops/
```
