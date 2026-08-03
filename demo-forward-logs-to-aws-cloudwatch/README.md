# Forward Logs to AWS CloudWatch (Deprecated)

> **DEPRECATED:** This demo uses the Elasticsearch/Fluentd logging stack
> (Cluster Logging Operator `stable-5.6`), which has been deprecated by Red Hat
> in OpenShift Logging 5.9+. For current logging demos, see:
> - [OpenShift Logging with LokiStack](../demo-openshift-logging)
> - [Multi-Namespace Log & Metrics Forwarding](../demo-multi-namespace-log-metrics-forwarding)
>
> The YAML manifests in this folder are preserved for historical reference only
> and may not function on current OpenShift versions.

This demo configures OpenShift cluster logging to forward infrastructure and audit logs to AWS CloudWatch using the `ClusterLogForwarder` resource with a Fluentd-based collector.

## Overview

* **Elasticsearch Operator** (`stable` channel) -- Manages the Elasticsearch backend for local log storage.
* **Cluster Logging Operator** (`stable-5.6`, pinned to CSV `v5.6.5`) -- Deploys the ClusterLogging instance and log forwarding pipeline.
* **ClusterLogForwarder** -- Routes `infrastructure` and `audit` logs to CloudWatch with prefix `poc-andyr` in `eu-west-1`.

## Prerequisites

* A ROSA cluster.
* AWS CLI configured with credentials that have CloudWatch Logs permissions (`logs:CreateLogGroup`, `logs:CreateLogStream`, `logs:PutLogEvents`).
* `oc` CLI with cluster-admin access.

## How to Run the Demo

### 1. Create the Operator Namespaces

```bash
oc apply -f eo-namespace.yaml
oc apply -f olo-namespace.yaml
```

### 2. Deploy the Operator Groups

```bash
oc apply -f eo-og.yaml
oc apply -f openshift-logging-og.yaml
```

### 3. Subscribe to the Operators

```bash
oc apply -f eo-sub.yaml
oc apply -f cluster-logging-sub.yaml
```

Wait for both operators to install:

```bash
oc get csv -n openshift-operators-redhat -w
oc get csv -n openshift-logging -w
```

### 4. Create the AWS Credentials Secret

The `ClusterLogForwarder` expects a secret named `cw-sts-secret` in the `openshift-logging` namespace:

```bash
oc create secret generic cw-sts-secret \
  -n openshift-logging \
  --from-literal=aws_access_key_id=<YOUR_ACCESS_KEY> \
  --from-literal=aws_secret_access_key=<YOUR_SECRET_KEY>
```

### 5. Deploy the Logging Stack

```bash
oc apply -f logging.yaml
```

### 6. Deploy the Log Forwarder

**Note:** Edit `logforwarder.yaml` to customize the `groupPrefix` and `region` values for your environment.

```bash
oc apply -f logforwarder.yaml
```

Verify logs are flowing:

```bash
oc get pods -n openshift-logging
oc logs -n openshift-logging -l component=collector
```

### 7. Verify in AWS CloudWatch

Check the AWS CloudWatch console in the configured region (`eu-west-1`) for log groups prefixed with `poc-andyr`.

## Clean Up

```bash
oc delete -f logforwarder.yaml
oc delete -f logging.yaml
oc delete -f cluster-logging-sub.yaml
oc delete -f eo-sub.yaml
oc delete -f openshift-logging-og.yaml
oc delete -f eo-og.yaml
oc delete -f olo-namespace.yaml
oc delete -f eo-namespace.yaml
```
