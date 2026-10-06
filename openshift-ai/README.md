# OpenShift AI Base Demo

GPU infrastructure for all AI demos: Node Feature Discovery, NVIDIA GPU drivers, and Red Hat OpenShift AI.

## Prerequisites

- OpenShift cluster with GPU nodes (e.g. `deploy_ai_machine_pool = true` in terraform)
- `oc` CLI logged in as cluster-admin

## Setup

### 1. Deploy NFD Operator

```bash
oc apply -f nfd.yaml
```

Wait for the CSV to succeed:

```bash
oc get csv -n openshift-nfd
```

### 2. Create NFD Instance

```bash
oc apply -f nfd-instance.yaml
```

### 3. Deploy NVIDIA GPU Operator

```bash
oc apply -f nvidia-gpu-operator.yaml
```

Wait for the CSV:

```bash
oc get csv -n nvidia-gpu-operator
```

### 4. Create ClusterPolicy

```bash
oc apply -f nvidia-cluster-policy.yaml
```

### 5. Deploy ServiceMesh and Serverless Operators

Required by KServe in RHOAI:

```bash
oc apply -f servicemesh.yaml
oc apply -f serverless.yaml
```

### 6. Deploy RHOAI Operator

```bash
oc apply -f namespace.yaml
oc apply -f subscription.yaml
```

Wait for the CSV:

```bash
oc get csv -n redhat-ods-operator
```

### 7. Create DataScienceCluster

```bash
oc apply -f data-science-cluster.yaml
```

## Verify

```bash
# GPU detected by NFD
oc get nodes -l feature.node.kubernetes.io/pci-10de.present=true

# NVIDIA drivers running
oc get clusterpolicy gpu-cluster-policy -o jsonpath='{.status.state}'
# Expected: ready

# GPU allocatable
oc get nodes -l nvidia.com/gpu.present=true -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.status.allocatable.nvidia\.com/gpu}{"\n"}{end}'

# RHOAI ready
oc get datasciencecluster default-dsc -o jsonpath='{.status.phase}'
# Expected: Ready
```

## Cleanup

```bash
oc delete datasciencecluster default-dsc
oc delete -f subscription.yaml
oc delete -f namespace.yaml
oc delete -f serverless.yaml
oc delete -f servicemesh.yaml
oc delete clusterpolicy gpu-cluster-policy
oc delete -f nvidia-gpu-operator.yaml
oc delete nodefeaturediscovery nfd-instance -n openshift-nfd
oc delete -f nfd.yaml
```
