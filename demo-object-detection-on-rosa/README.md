# Object Detection on ROSA

Serve a YOLO-based object detection model on ROSA using OpenShift AI. Upload images via a REST API and get back detected objects.

## Prerequisites

- [`openshift-ai/`](../openshift-ai/) demo deployed (NFD, NVIDIA GPU Operator, RHOAI)
- GPU node available and ClusterPolicy state is `ready`
- Cluster built with `deploy_ai_machine_pool = true` in terraform

## Setup

### 1. Create a project

```bash
oc new-project ai-demo
```

### 2. Deploy the model service

Build and deploy the [Object Detection REST](https://github.com/rh-aiservices-bu/object-detection-rest) application using S2I:

```bash
oc new-app python:3.9-ubi8~https://github.com/rh-aiservices-bu/object-detection-rest.git --name=object-detection
```

### 3. Expose the service

```bash
oc expose svc/object-detection
```

## Verify

Wait for the build and deployment to complete:

```bash
oc get pods -w -n ai-demo
```

Get the route URL and test:

```bash
oc get route object-detection -n ai-demo -o jsonpath='{.spec.host}'
```

Open the URL in a browser to access the web interface, or use `curl` to POST an image to the `/predictions` endpoint.

## Cleanup

```bash
oc delete project ai-demo
```
