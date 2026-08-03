# Deploying Cluster Logging with Elasticsearch (Deprecated)

> **DEPRECATED:** This demo uses the Elasticsearch/Fluentd/Kibana logging stack,
> which has been deprecated by Red Hat in OpenShift Logging 5.9+. For current
> logging demos, see:
> - [OpenShift Logging with LokiStack](../demo-openshift-logging)
> - [Multi-Namespace Log & Metrics Forwarding](../demo-multi-namespace-log-metrics-forwarding)
>
> The YAML manifests in this folder are preserved for historical reference only
> and may not function on current OpenShift versions.

This demo deploys the legacy OpenShift cluster logging stack using the Elasticsearch Operator and the Cluster Logging Operator. It provisions a 3-node Elasticsearch cluster with Kibana for visualization and Fluentd for log collection.

## Overview

* **Elasticsearch Operator** (`stable` channel) -- Manages the Elasticsearch cluster for log storage.
* **Cluster Logging Operator** (`stable-5.8` channel) -- Deploys and manages the ClusterLogging instance.
* **ClusterLogging instance** -- 3-node Elasticsearch with 200GB gp2 storage, Kibana visualization, and Fluentd collection.

## Prerequisites

* A ROSA, ARO, or OSD cluster.
* `oc` CLI with cluster-admin access.

## How to Run the Demo

### 1. Create the Required Namespaces

```bash
oc apply -f namespaces.yaml
```

This creates the `openshift-operators-redhat` and `openshift-logging` namespaces.

### 2. Deploy the Operator Groups

```bash
oc apply -f operatorgroups.yaml
```

### 3. Subscribe to the Operators

```bash
oc apply -f subscriptions.yaml
```

Wait for both operators to install:

```bash
oc get csv -n openshift-operators-redhat -w
oc get csv -n openshift-logging -w
```

### 4. Deploy the Logging Stack

```bash
oc apply -f logging.yaml
```

Monitor the Elasticsearch pods:

```bash
oc get pods -n openshift-logging -w
```

### 5. Access Kibana

Once all pods are running, access the Kibana dashboard via the OpenShift console under **Observability > Logging**, or retrieve the route:

```bash
oc get route kibana -n openshift-logging
```

## Clean Up

```bash
oc delete -f logging.yaml
oc delete -f subscriptions.yaml
oc delete -f operatorgroups.yaml
oc delete -f namespaces.yaml
```
