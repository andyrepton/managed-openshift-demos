# Object Detection on ROSA

This demo deploys a YOLO-based object detection service on Red Hat OpenShift
Service on AWS (ROSA), built straight from GitHub with OpenShift source-to-image
and exposed with a Route. You send an image to its REST `/predictions` endpoint
and get back the objects detected in it, with their scores. It runs on ordinary
CPU worker nodes with the model bundled in the image, so it needs no GPU and no
extra platform setup. It is here as a quick, visual example of serving an AI
model as a normal application on ROSA.

Tested: 2026-11-04, ROSA HCP 4.22.12.

## Prerequisites

- An OpenShift cluster with `oc` logged in. The service runs on CPU worker
  nodes: it needs no GPU and no OpenShift AI.

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

Check the service is up:

```bash
HOST=$(oc get route object-detection -n ai-demo -o jsonpath='{.spec.host}')
curl -s "http://$HOST/status"
# {"status":"ok"}
```

Send the sample image from the application's repository (a base64-encoded
photo in a JSON body) and list what was detected:

```bash
curl -s https://raw.githubusercontent.com/rh-aiservices-bu/object-detection-rest/master/sample-requests/twodogs.json \
  | curl -s -X POST -H 'Content-Type: application/json' --data @- "http://$HOST/predictions" \
  | jq -c '.detections[] | {class, score}'
# {"class":"Dog","score":0.84...}
# {"class":"Dog","score":0.79...}
```

The service has no web interface: `/` returns the same status as `/status`.

## Cleanup

```bash
oc delete project ai-demo
```
