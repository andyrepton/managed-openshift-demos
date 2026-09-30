# Forward Logs to AWS CloudWatch

Forward OpenShift infrastructure and audit logs to AWS CloudWatch using
the Cluster Logging Operator 6.x with a Vector collector and IRSA
(IAM Roles for Service Accounts) authentication.

## Overview

* **Cluster Logging Operator** (`stable-6.6`) — Deploys the Vector-based
  log collector and manages the `ClusterLogForwarder` pipeline.
* **ClusterLogForwarder** — Routes `infrastructure` and `audit` logs to
  CloudWatch with prefix `poc-andyr` in the configured region.
* **IRSA** — The collector assumes an IAM role via OIDC federation.
  No long-lived AWS credentials are stored on the cluster.

No Elasticsearch Operator or `ClusterLogging` CR is needed — the
`ClusterLogForwarder` is the only custom resource required.

## Prerequisites

* A ROSA HCP cluster (tested on ROSA HCP 4.22).
* The CloudWatch IAM role created by terraform — set
  `deploy_cloudwatch_logging = true` in your tfvars (see
  `andys-demo-cluster-tf/`). The role ARN is output as
  `cloudwatch_iam_role_arn`.
* `oc` CLI with cluster-admin access.

## Setup

### 1. Create the namespace and OperatorGroup

```bash
oc apply -f olo-namespace.yaml
oc apply -f openshift-logging-og.yaml
```

### 2. Install the Cluster Logging Operator

```bash
oc apply -f cluster-logging-sub.yaml

# Wait for the operator to install:
oc get csv -n openshift-logging -w
```

### 3. Create the collector ServiceAccount and RBAC

The Vector collector needs explicit permissions to collect
infrastructure and audit logs:

```bash
oc apply -f serviceaccount.yaml
```

### 4. Create the IAM role ARN secret

Use the role ARN from the terraform output:

```bash
ROLE_ARN=$(cd ../andys-demo-cluster-tf && terraform output -raw cloudwatch_iam_role_arn)

oc create secret generic cloudwatch-role \
  -n openshift-logging \
  --from-literal=role_arn="$ROLE_ARN"
```

### 5. Deploy the ClusterLogForwarder

Edit `logforwarder.yaml` to set your `groupName` prefix and `region`,
then apply:

```bash
oc apply -f logforwarder.yaml
```

### 6. Verify

```bash
# Collector pods should be running on each node:
oc get pods -n openshift-logging

# Check collector logs for errors:
oc logs -n openshift-logging -l app.kubernetes.io/component=collector --tail=20

# Verify in the AWS CloudWatch console under the configured region
```

## Clean Up

```bash
oc delete -f logforwarder.yaml
oc delete secret cloudwatch-role -n openshift-logging
oc delete -f serviceaccount.yaml
oc delete -f cluster-logging-sub.yaml
oc delete csv -n openshift-logging --all
oc delete -f openshift-logging-og.yaml
oc delete -f olo-namespace.yaml
```
