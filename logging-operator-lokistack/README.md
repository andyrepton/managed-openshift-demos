# OpenShift Logging and Loki operators for LokiStack

This folder installs the two operators that LokiStack logging needs on a managed
OpenShift cluster such as ROSA: the Red Hat OpenShift Logging operator (the
Vector collector and the `ClusterLogForwarder` API) in `openshift-logging`, and
the Loki Operator (the `LokiStack` API) in `openshift-operators-redhat`, both
on the Logging 6.6 channel. It creates no log store and forwards nothing on its
own. It is here as the shared base for the repo's LokiStack demo,
[demo-openshift-logging](../demo-openshift-logging), so that demo only
contains the stage steps.

Tested: 2026-11-04, ROSA HCP 4.22.12, Logging 6.6.2, Loki Operator 6.6.2.

## Prerequisites

* A ROSA cluster (tested on ROSA HCP 4.22).
* `oc` CLI with cluster-admin access.

## Setup

Run these from this folder. ROSA creates both namespaces with the cluster;
the commands below label them and add what is missing.

### 1. Install the Logging operator

```bash
oc label namespace openshift-logging openshift.io/cluster-monitoring=true --overwrite
oc apply -f operatorgroup.yaml
oc apply -f subscription.yaml
```

The OperatorGroup is named `openshift-logging` to match
[demo-forward-logs-to-aws-cloudwatch](../demo-forward-logs-to-aws-cloudwatch),
which installs the same operator into the same namespace. A namespace with two
OperatorGroups stops OLM installing anything in it. If that demo is already
deployed, these commands change nothing.

### 2. Install the Loki Operator

```bash
oc apply -f loki-operator.yaml
```

### 3. Verify

Both operators report `Succeeded`:

```bash
until oc get csv -n openshift-logging 2>/dev/null | grep cluster-logging | grep -q Succeeded; do sleep 10; done
until oc get csv -n openshift-operators-redhat 2>/dev/null | grep loki-operator | grep -q Succeeded; do sleep 10; done
oc get csv -n openshift-logging | grep cluster-logging
oc get csv -n openshift-operators-redhat | grep loki-operator
```

Next, follow [demo-openshift-logging](../demo-openshift-logging) to create the
LokiStack and forward logs to it. The background is in the Red Hat Cloud
Experts article
[OpenShift Logging with LokiStack](https://cloud.redhat.com/experts/o11y/openshift-logging-lokistack/).

## Clean Up

Remove the demos that use these operators first. Then delete only these
operators' CSVs, never `--all`: `openshift-logging` also holds copies of every
all-namespaces operator.

```bash
oc delete subscription loki-operator -n openshift-operators-redhat
oc delete csv -n openshift-operators-redhat \
  "$(oc get csv -n openshift-operators-redhat -o name | grep loki-operator | cut -d/ -f2)"
oc delete operatorgroup loki-operator -n openshift-operators-redhat

# Skip these three if demo-forward-logs-to-aws-cloudwatch still uses the operator
oc delete -f subscription.yaml
oc delete csv -n openshift-logging \
  "$(oc get csv -n openshift-logging -o name | grep cluster-logging | cut -d/ -f2)"
oc delete -f operatorgroup.yaml
```

Leave both namespaces in place: ROSA created them.
