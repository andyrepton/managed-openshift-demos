# Forward Metrics to AWS CloudWatch

This demo deploys the Amazon CloudWatch agent on an OpenShift cluster to scrape Prometheus metrics from the Kubernetes API server and forward them to AWS CloudWatch Container Insights. It includes pre-built CloudWatch dashboard definitions for visualizing API server health.

## Overview

* **CloudWatch Agent** -- Deployed as a single-replica `Deployment` running `amazon/cloudwatch-agent:1.247348.0b251302` with Prometheus scrape configuration.
* **Prometheus Scraping** -- Scrapes the `kubernetes-apiservers` job for metrics including `apiserver_request_total`, `etcd_object_counts`, and `workqueue_*` metrics.
* **CloudWatch Dashboards** -- Two dashboard templates: `dashboard.json` (full API server dashboard) and `basic-dash.json` (starting template).

## Prerequisites

* A ROSA cluster.
* AWS CLI configured with permissions for CloudWatch (`CloudWatchAgentServerPolicy`).
* `oc` CLI with cluster-admin access.
* `jq` installed.

## How to Run the Demo

### Option A: Automated Setup

From the repository root:

```bash
./create-demo.sh
```

Select **Demo 2 (CloudWatch Metrics)** when prompted.

### Option B: Manual Setup

#### 1. Create AWS Credentials Secret

Create an IAM user with `CloudWatchAgentServerPolicy` and store the credentials:

```bash
oc create namespace amazon-cloudwatch

oc create secret generic aws-credentials \
  -n amazon-cloudwatch \
  --from-file=credentials=<path-to-aws-credentials-file>
```

#### 2. Customize the Configuration

**Important:** Edit `cloud-watch.yaml` to replace the following hardcoded values:
* `poc-andyr` -- Replace with your cluster name
* `eu-west-1` -- Replace with your AWS region

#### 3. Deploy the CloudWatch Agent

```bash
oc apply -f cloud-watch.yaml
```

This creates the namespace, ConfigMaps, ServiceAccount, RBAC, and Deployment.

#### 4. Verify the Agent

```bash
oc get pods -n amazon-cloudwatch
oc logs -n amazon-cloudwatch -l app=cwagent-prometheus
```

#### 5. Deploy the CloudWatch Dashboard

```bash
aws cloudwatch put-dashboard \
  --dashboard-name "OpenShift-API-Server" \
  --dashboard-body file://dashboard.json
```

## Clean Up

```bash
oc delete -f cloud-watch.yaml
aws cloudwatch delete-dashboards --dashboard-names "OpenShift-API-Server"
```

To also remove the IAM user, run `./create-demo.sh` and select the clean option, or delete manually via the AWS CLI.
