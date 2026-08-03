# Deploying an Application with OpenShift Service Mesh

This demo shows how to enroll an application namespace into OpenShift Service Mesh using both `ServiceMeshMemberRoll` and `ServiceMeshMember` resources. It demonstrates two patterns for joining namespaces to the mesh.

## Overview

* **ServiceMeshMemberRoll** (`servicemeshroll.yaml`) -- The mesh administrator adds the `hello` namespace to the centrally managed member list in `istio-system`.
* **ServiceMeshMember** (`servicemeshmember.yaml`) -- The namespace owner self-enrolls by creating a `ServiceMeshMember` resource in their own namespace, referencing the control plane in `istio-system`.
* Both resources use the Maistra `v1` API and reference a `ServiceMeshControlPlane` named `basic`.

## Prerequisites

* A ROSA, ARO, or OSD cluster.
* OpenShift Service Mesh operator installed (see `../openshift-service-mesh`).
* A `ServiceMeshControlPlane` named `basic` deployed in the `istio-system` namespace.
* `oc` CLI with cluster-admin access.

## How to Run the Demo

### 1. Create the Application Namespace

```bash
oc new-project hello
```

### 2. Enroll via ServiceMeshMemberRoll (Admin Pattern)

This adds the `hello` namespace to the mesh from the control plane namespace:

```bash
oc apply -f servicemeshroll.yaml
```

### 3. Enroll via ServiceMeshMember (Self-Service Pattern)

Alternatively, the namespace owner can self-enroll:

```bash
oc apply -f servicemeshmember.yaml
```

### 4. Deploy an Application

Deploy any application into the `hello` namespace. Pods will automatically get Envoy sidecar injection:

```bash
oc new-app httpd~https://github.com/sclorg/httpd-ex.git -n hello
```

### 5. Verify Mesh Enrollment

```bash
oc get smmr default -n istio-system -o jsonpath='{.status.members}'
oc get pods -n hello -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{range .spec.containers[*]}{.name}{", "}{end}{"\n"}{end}'
```

Look for the `istio-proxy` sidecar container alongside your application container.

## Clean Up

```bash
oc delete -f servicemeshmember.yaml
oc delete -f servicemeshroll.yaml
oc delete project hello
```
