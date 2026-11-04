# Install the Skupper operator (Service Interconnect)

This folder installs the Skupper operator, the upstream community project behind
Red Hat Service Interconnect, into `openshift-operators` on an OpenShift
cluster, from Skupper's own catalog (operator index v1.5.0, `alpha` channel)
rather than the Red Hat-supported Service Interconnect operator. You can apply
it with `oc` or let OpenShift GitOps sync it from this repo. It covers only the
operator install, as a base for connecting services across clusters.

### Option 1: Manually

```bash
oc apply -f .
```

Skupper will be installed in the openshift-operators namespace

### Option 2: GitOps

- Go to the gitops folder [here](../openshift-gitops) and install gitops
- Create the application file in the gitops folder:

```bash
oc apply -f gitops/
```
