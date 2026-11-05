# Forward Metrics to AWS CloudWatch

This demo runs the Amazon CloudWatch agent on a Red Hat OpenShift Service on AWS
(ROSA) cluster to scrape Prometheus metrics from the Kubernetes API server and
send them to CloudWatch Container Insights, with ready-made dashboards for API
server health. Teams that already monitor AWS with CloudWatch can see OpenShift
control-plane metrics next to their other AWS resources. It is here to show that
metrics from a managed OpenShift cluster can flow into the cloud provider's own
monitoring service.

Tested: 2026-11-05, ROSA HCP 4.22.12, CloudWatch agent 1.300074.1b2005 (including Clean Up, then a clean replay).

## Overview

* **CloudWatch agent**: a single-replica `Deployment` running
  `amazon/cloudwatch-agent:1.300074.1b2005` with a Prometheus scrape
  configuration.
* **Prometheus scraping**: the `kubernetes-apiservers` job, for metrics
  including `apiserver_request_total`, `apiserver_storage_objects` and
  `workqueue_*`. On ROSA with hosted control planes this reaches the hosted
  API server.
* **No AWS keys on the cluster**: the agent assumes an IAM role with its
  ServiceAccount token (IRSA).
* **CloudWatch dashboards**: `dashboard.json` (API server dashboard) and
  `basic-dash.json` (an empty starting template).

## Prerequisites

* A ROSA cluster with the agent's IAM role: apply
  [andys-demo-cluster-tf](../andys-demo-cluster-tf) with
  `deploy_cloudwatch_metrics = true`. The role trusts only the
  `cwagent-prometheus` ServiceAccount in `amazon-cloudwatch` and has
  `CloudWatchAgentServerPolicy`.
* `oc` CLI with cluster-admin access.
* AWS CLI, for the dashboard and verify steps.

## How to Run the Demo

Run these from this folder.

### 1. Deploy the CloudWatch agent

Set your cluster name and region, take the role ARN from the Terraform output
(run from the checkout that holds the Terraform state), and apply:

```bash
CLUSTER_NAME=<your-cluster-name>
AWS_REGION=<your-region>
ROLE_ARN=$(cd ../andys-demo-cluster-tf && terraform output -raw cloudwatch_metrics_iam_role_arn)

sed -e "s/CLUSTER_NAME_REPLACE_ME/${CLUSTER_NAME}/g" -e "s/AWS_REGION_REPLACE_ME/${AWS_REGION}/g" \
  -e "s#ROLE_ARN_REPLACE_ME#${ROLE_ARN}#" cloud-watch.yaml | oc apply -f -
oc rollout status deploy/cwagent-prometheus -n amazon-cloudwatch --timeout=5m
```

This creates the namespace, ConfigMaps, ServiceAccount, RBAC and Deployment.

### 2. Verify the agent

The pod is `Running` with no restarts, and within a couple of minutes the
metrics land in a log group named after your cluster:

```bash
oc get pods -n amazon-cloudwatch
aws logs describe-log-streams --region "$AWS_REGION" \
  --log-group-name "/aws/containerinsights/${CLUSTER_NAME}/prometheus" \
  --query 'logStreams[].logStreamName' --output text
```

The second command prints `kubernetes-apiservers`. The agent logs a
`failed to read certificate` error for an EKS add-on certificate; it does not
affect this demo.

### 3. Deploy the CloudWatch dashboard

```bash
aws cloudwatch put-dashboard --region "$AWS_REGION" \
  --dashboard-name "OpenShift-API-Server-${CLUSTER_NAME}" \
  --dashboard-body "$(sed -e "s/CLUSTER_NAME_REPLACE_ME/${CLUSTER_NAME}/g" \
    -e "s/AWS_REGION_REPLACE_ME/${AWS_REGION}/g" dashboard.json)"
```

It prints `"DashboardValidationMessages": []`. Open **CloudWatch > Dashboards**
in the AWS console; the graphs fill in as CloudWatch turns the log events into
metrics (allow up to 15 minutes the first time).

## Clean Up

```bash
sed -e "s/CLUSTER_NAME_REPLACE_ME/${CLUSTER_NAME}/g" -e "s/AWS_REGION_REPLACE_ME/${AWS_REGION}/g" \
  -e "s#ROLE_ARN_REPLACE_ME#${ROLE_ARN}#" cloud-watch.yaml | oc delete -f -
aws cloudwatch delete-dashboards --region "$AWS_REGION" \
  --dashboard-names "OpenShift-API-Server-${CLUSTER_NAME}"
aws logs delete-log-group --region "$AWS_REGION" \
  --log-group-name "/aws/containerinsights/${CLUSTER_NAME}/prometheus"
```

Then set `deploy_cloudwatch_metrics = false` and re-apply Terraform to remove
the IAM role.
