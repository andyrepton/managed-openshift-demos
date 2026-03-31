# OpenShift AI on ROSA: Object Detection Demo

This demo shows how to use **Red Hat OpenShift AI (RHOAI)** on a ROSA cluster to serve a computer vision model. We use a GPU-enabled instance to perform real-time object detection on images via a REST API.

## Overview
* **Infrastructure:** ROSA HCP cluster with a GPU machine pool (NVIDIA G4ad/G5).
* **Acceleration:** NVIDIA GPU Operator + Node Feature Discovery (NFD).
* **Platform:** Red Hat OpenShift AI (Operator-based).
* **Model:** YOLO-based object detection served as a Flask application.

## Prerequisites

### 1. Provision the Cluster

Ensure your cluster is built using the [andys-demo-cluster-tf](https://github.com/andyrepton/managed-openshift-demos/tree/main/andys-demo-cluster-tf) code with the AI machine pool enabled:

```bash
export TF_VAR_deploy_ai_machine_pool=true
terraform apply
```

### 2. Verify GPU Nodes

Before proceeding, confirm your GPU nodes are joined to the cluster:
```bash
oc get nodes -l node.kubernetes.io/instance-type=<your_gpu_instance_type>
```

---

## Installation Steps

### Step 1: Install GPU Dependencies
OpenShift AI requires the **NVIDIA GPU Operator** to manage the drivers and the **Node Feature Discovery (NFD)** operator to label the hardware.

1. **Install NFD:**

   ```bash
   oc apply -f https://raw.githubusercontent.com/andyrepton/managed-openshift-demos/main/demo-openshift-ai-on-rosa/operators/nfd.yaml
   ```

2. **Install NVIDIA GPU Operator:**

   ```bash
   oc apply -f https://raw.githubusercontent.com/andyrepton/managed-openshift-demos/main/demo-openshift-ai-on-rosa/operators/nvidia-gpu.yaml
   ```

3. **Wait for ClusterPolicy:** The GPU operator will take a few minutes to compile the drivers. Check the status with:

   ```bash
   oc get clusterpolicy gpu-cluster-policy -o jsonpath='{.status.state}'
   ```

### Step 2: Install Red Hat OpenShift AI

Once the hardware is ready, deploy the OpenShift AI operator:

1. **Apply the Operator Subscription:**

   ```bash
   oc apply -f ./operators/rhoai-operator.yaml
   ```

2. **Create the DataScienceCluster initialization:**

   ```bash
   oc apply -f ./openshift-ai/data-science-cluster.yaml
   ```

---

## Running the Demo: Object Detection

We will use the [Object Detection REST](https://github.com/rh-aiservices-bu/object-detection-rest) project to serve a model that can identify objects in uploaded images.

### 1. Create a Project

```bash
oc new-project ai-demo
```

### 2. Deploy the Model Service

Deploy the application using the Source-to-Image (S2I) flow. This builds the container directly from the upstream repository:

```bash
oc new-app python:3.9-ubi8~https://github.com/rh-aiservices-bu/object-detection-rest.git --name=object-detection
```

### 3. Expose the Service

```bash
oc expose svc/object-detection
```

### 4. Test the Detection

Once the pod is running, find your URL:
```bash
oc get route object-detection
```
You can now access the web interface or use `curl` to post an image to the `/predictions` endpoint to receive a JSON response of detected objects.

---

## Clean Up
To remove the demo application:
```bash
oc delete project ai-demo
```
To remove the operators and their associated resources, see the `cleanup.sh` script in this folder.

