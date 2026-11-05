# Forward Logs to AWS CloudWatch

This demo sends the infrastructure and audit logs of a Red Hat OpenShift Service
on AWS (ROSA) cluster with hosted control planes to Amazon CloudWatch, using the
Cluster Logging Operator 6.x with a Vector collector and one
`ClusterLogForwarder` resource. The collector authenticates with IAM Roles for
Service Accounts, so no long-lived AWS credentials are stored on the cluster.
Customers can keep OpenShift logs with the rest of their AWS logging, without
running Elasticsearch or Loki on the cluster. It is here to show ROSA using
native AWS services with short-lived, role-based credentials.

Tested: 2026-11-04, ROSA HCP 4.22.12, Logging 6.6.2.

## Overview

* **Cluster Logging Operator** (`stable-6.6`): Deploys the Vector-based
  log collector and manages the `ClusterLogForwarder` pipeline.
* **ClusterLogForwarder**: Routes `infrastructure` and `audit` logs to
  CloudWatch log groups named `<cluster-name>.infrastructure` and
  `<cluster-name>.audit` in the configured region.
* **IRSA**: The collector assumes an IAM role via OIDC federation.
  No long-lived AWS credentials are stored on the cluster.

No Elasticsearch Operator or `ClusterLogging` CR is needed. The
`ClusterLogForwarder` is the only custom resource required.

## Prerequisites

* A ROSA HCP cluster (tested on ROSA HCP 4.22).
* The CloudWatch IAM role created by terraform: set
  `deploy_cloudwatch_logging = true` in your tfvars (see
  `andys-demo-cluster-tf/`). The role ARN is output as
  `cloudwatch_iam_role_arn`.
* `oc` CLI with cluster-admin access, and the AWS CLI for the verify step.

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
until oc get csv -n openshift-logging 2>/dev/null | grep cluster-logging | grep -q Succeeded; do sleep 10; done
```

### 3. Create the collector ServiceAccount and RBAC

The Vector collector needs explicit permissions to collect
infrastructure and audit logs:

```bash
oc apply -f serviceaccount.yaml
```

### 4. Create the IAM role ARN secret

Use the role ARN from the terraform output (run this from the checkout that
holds the Terraform state):

```bash
ROLE_ARN=$(cd ../andys-demo-cluster-tf && terraform output -raw cloudwatch_iam_role_arn)

oc create secret generic cloudwatch-role \
  -n openshift-logging \
  --from-literal=role_arn="$ROLE_ARN"
```

### 5. Deploy the ClusterLogForwarder

Set your cluster name (the log group prefix) and AWS region, then apply:

```bash
CLUSTER_NAME=<your-cluster-name>
AWS_REGION=<your-region>

sed -e "s/poc-andyr\./${CLUSTER_NAME}./" -e "s/region: eu-west-2/region: ${AWS_REGION}/" \
  logforwarder.yaml | oc apply -f -
oc wait clusterlogforwarder/instance -n openshift-logging --for=condition=Ready --timeout=180s
```

### 6. Verify

```bash
# Collector pods should be running on each node:
oc get pods -n openshift-logging

# Check collector logs for errors:
oc logs -n openshift-logging -l app.kubernetes.io/component=collector --tail=20

# The two log groups exist and have log streams (the byte count lags behind):
aws logs describe-log-groups --region "$AWS_REGION" \
  --log-group-name-prefix "${CLUSTER_NAME}." --query 'logGroups[].logGroupName' --output text
aws logs describe-log-streams --region "$AWS_REGION" \
  --log-group-name "${CLUSTER_NAME}.infrastructure" --order-by LastEventTime --descending \
  --max-items 3 --query 'logStreams[].logStreamName' --output text
```

The same groups appear in the AWS CloudWatch console under Logs, Log groups.

## Clean Up

```bash
oc delete -f logforwarder.yaml
oc delete secret cloudwatch-role -n openshift-logging
oc delete -f serviceaccount.yaml
oc delete -f cluster-logging-sub.yaml
oc delete csv -n openshift-logging \
  "$(oc get csv -n openshift-logging -o name | grep cluster-logging | cut -d/ -f2)"
oc delete -f openshift-logging-og.yaml
```

Leave the `openshift-logging` namespace in place: ROSA creates it with the
cluster, and other logging demos install into it. Delete only this demo's CSV,
never `--all`: the namespace also holds copies of every all-namespaces operator
and any other logging operator installed there. The CloudWatch log groups stay
in AWS until you delete them:

```bash
aws logs delete-log-group --region "$AWS_REGION" --log-group-name "${CLUSTER_NAME}.infrastructure"
aws logs delete-log-group --region "$AWS_REGION" --log-group-name "${CLUSTER_NAME}.audit"
```
