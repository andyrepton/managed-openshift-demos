# Install the Skupper operator (Service Interconnect)

This folder installs the Skupper operator, the upstream community project behind
Red Hat Service Interconnect, into `openshift-operators` on an OpenShift
cluster, from Skupper's own catalog (operator index v1.5.0, `alpha` channel)
rather than the Red Hat-supported Service Interconnect operator. You can apply
it with `oc` or let OpenShift GitOps sync it from this repo. It covers only the
operator install, as a base for connecting services across clusters.

Tested: 2026-11-05, ROSA HCP 4.22.12, Skupper operator 1.5.0 (Option 1).

### Option 1: Manually

```bash
oc apply -f .
```

Skupper will be installed in the openshift-operators namespace. Wait for it:

```bash
until oc get csv -n openshift-operators 2>/dev/null | grep skupper-operator | grep -q Succeeded; do sleep 10; done
oc get csv -n openshift-operators | grep skupper-operator
```

### Option 2: GitOps

- Go to the gitops folder [here](../openshift-gitops) and install gitops
- Create the application file in the gitops folder:

```bash
oc apply -f gitops/
```

The Application syncs this folder from GitHub `main`, so it installs the same
two objects as Option 1.

## Note on support

This is the upstream Skupper 1.5.0 operator from Skupper's own catalog, which
Red Hat does not support. The supported Red Hat Service Interconnect operator
is in the `redhat-operators` catalog as `skupper-operator` (channels up to
`stable-2`, checked on OpenShift 4.22).

## Clean Up

```bash
oc delete subscription skupper-operator -n openshift-operators
oc delete csv -n openshift-operators \
  "$(oc get csv -n openshift-operators -o name | grep skupper-operator | cut -d/ -f2)"
oc delete catalogsource skupper-operator -n openshift-marketplace
```
