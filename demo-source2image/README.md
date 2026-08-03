# Source-to-Image (S2I) and Dev Spaces Demo

This demo shows OpenShift's Source-to-Image (S2I) capability to build and deploy a Go application directly from source code, without writing a Dockerfile. It then extends the workflow using OpenShift Dev Spaces for in-browser development and rapid iteration via binary builds.

## Overview

* **Source-to-Image** -- Builds a container image from source code using a builder image (`golang~`), compiles the Go application, and deploys it automatically.
* **Dev Spaces** -- Provides a browser-based IDE running inside the cluster for editing code and triggering rebuilds.
* **Binary builds** -- Uses `oc start-build --from-dir=.` to push local code changes directly into the build pipeline for rapid CI iteration.

## Prerequisites

* A ROSA, ARO, or OSD cluster.
* OpenShift Dev Spaces installed (see `../openshift-devspaces`).
* `oc` CLI logged in to the cluster.
* Access to GitHub (the demo uses `https://github.com/andyrepton/hello`).

## How to Run the Demo

Detailed presenter notes with talking points are in `during-your-demo.md`. The steps below are a summary.

### 1. Create the Project

```bash
oc new-project s2i-demo
```

### 2. Build and Deploy from Source

```bash
oc new-app golang~https://github.com/andyrepton/hello.git
```

Watch the build:

```bash
oc logs -f buildconfig/hello
```

### 3. Expose the Application

```bash
oc expose deployment hello --port 8080
oc create route edge --service=hello
oc get route hello
```

Open the route URL in a browser to see the running application.

### 4. Open Dev Spaces

Navigate to Dev Spaces in the OpenShift console and create a workspace from `https://github.com/andyrepton/hello.git`.

### 5. Set Up a Binary Build Pipeline

From the Dev Spaces terminal:

```bash
oc new-build --binary --image-stream openshift/golang --name demo --strategy source
```

### 6. Iterate with Binary Builds

Edit the source code in Dev Spaces, then trigger a build:

```bash
oc start-build demo --from-dir=. --follow
```

Deploy the updated image:

```bash
oc get imagestream demo
oc new-app --name demo <image-from-imagestream>
oc expose deployment/demo --port 8080
oc create route edge --service=demo
```

Subsequent changes only need:

```bash
oc start-build demo --from-dir=. --follow
```

Refresh the browser to see updates.

## Clean Up

```bash
oc delete buildconfig demo hello
oc delete deployment demo hello
oc delete imagestream demo hello
oc delete service demo hello
oc delete route demo hello
oc delete project s2i-demo
```

Also delete any Dev Spaces workspaces created during the demo.
