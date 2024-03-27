## 11 Deploying OpenShift Dev Spaces onto a Managed OpenShift Cluster using the command line or via GitOps

### Option 1: Manually

```bash
oc apply -f .
```

Dev Spaces will be installed in the openshift-operators namespace

### Option 2: GitOps

- Go to the gitops folder [here](../openshift-gitops) and install gitops
- Create the application file in the gitops folder:

```bash
oc apply -f gitops/
```

