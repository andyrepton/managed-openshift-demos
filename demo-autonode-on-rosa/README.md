# ROSA AutoNode Demo (Karpenter-based Scaling)

This demo shows AutoNode, the Karpenter-based node autoscaler for Red Hat
OpenShift Service on AWS (ROSA) with hosted control planes. Instead of fixed
machine pools, AutoNode watches for pods that cannot be scheduled and launches
EC2 instances that fit them, from on-demand or Spot capacity, then removes empty
or underused nodes when the work goes away. A stress-test workload makes this
visible. It is here to show that ROSA can size its compute to what workloads
actually request, scaling quickly and without paying for idle nodes.

Tested: 2026-11-05, on an existing ROSA HCP 4.22.12 cluster in eu-west-2 (no special shard needed): AutoNode launched a Spot t3.xlarge for the pending pod in about five minutes. Scale-down was not observed (the budget window was active).

By utilizing **Karpenter** logic, AutoNode moves away from static machine pools, allowing the cluster to provision nodes based on actual pod requirements. This improves scaling speed and cost efficiency by selecting the most appropriate AWS instance types dynamically.

## Overview

* **Infrastructure as Code:** [andys-demo-cluster-tf](../andys-demo-cluster-tf)
  with `deploy_autonode = true` creates AutoNode's IAM role and tags the
  cluster's private subnets and default security group with
  `karpenter.sh/discovery`, so AutoNode can find where to launch nodes.
* **Declarative Node Configuration:** an `OpenshiftEC2NodeClass` and a Karpenter
  `NodePool` define how and what AutoNode may launch.
* **Dynamic Scaling:** AutoNode watches for pending pods and launches
  right-sized EC2 instances, on-demand or Spot.

## Prerequisites

* A ROSA HCP cluster built with [andys-demo-cluster-tf](../andys-demo-cluster-tf).
* `rosa` and `oc` CLIs, logged in.

## How to run the demo

Run these from this folder.

### 1. Create the IAM role and discovery tags

Apply [andys-demo-cluster-tf](../andys-demo-cluster-tf) with
`deploy_autonode = true` added to your preset (for example
`-var deploy_autonode=true`). This only adds resources: the role, its policy and
the `karpenter.sh/discovery=<cluster-id>` tags.

```bash
CLUSTER_ID=$(rosa describe cluster -c <cluster-name> -o json | jq -r .id)
AUTONODE_ROLE_ARN=$(cd ../andys-demo-cluster-tf && terraform output -raw autonode_iam_role_arn)
```

The role trusts the `kube-system:karpenter` ServiceAccount of the hosted
control plane for the `openshift` and `sts.amazonaws.com` audiences. With
`sts.amazonaws.com` alone, OCM refuses it in the next step ("exists but cannot
be assumed by the Karpenter service account").

### 2. Enable AutoNode

```bash
rosa edit cluster --cluster "$CLUSTER_ID" --autonode=enabled --autonode-iam-role-arn="$AUTONODE_ROLE_ARN"
```

**After this, keep Terraform applies on this cluster targeted** (`-target=...`).
The cluster resource has an `auto_node` setting, but the `rosa-hcp` module
(1.7.5, and 1.7.6, the latest) does not expose it, so an untargeted plan shows
the cluster "updated in-place" with `auto_node` going to null, which would turn
AutoNode off again.

Within a minute or two the AutoNode APIs appear:

```bash
oc api-resources | grep -i karpenter
```

### 3. Configure the NodeClass

The `OpenshiftEC2NodeClass` tells AutoNode which subnets and security groups to
use, by the discovery tag from step 1:

```bash
sed "s/CLUSTER_ID/$CLUSTER_ID/g" openshiftec2nodeclass.tmpl | oc apply -f -
oc wait openshiftec2nodeclass example-nodeclass --for=condition=Ready --timeout=5m
```

It reports `SubnetsReady`, `SecurityGroupsReady` and `Ready`.

Nodes AutoNode launches get Karpenter's own tags only, not the default AWS
tags your machine pools carry. To tag them for cost tracking, add a `tags:`
map under `spec` in the NodeClass.

### 4. Create the NodePool

`nodepool.yaml` lets AutoNode choose `m5.xlarge`, `c5.xlarge` or `t3.xlarge`,
on-demand or Spot. AutoNode's admission policy refuses `.nano`, `.micro`,
`.small`, `.medium` and `.large` sizes.

```bash
oc apply -f nodepool.yaml
oc wait nodepools.karpenter.sh ondemand-and-spot --for=condition=Ready --timeout=5m
```

### 5. Deploy the workload

The stress test only schedules on nodes labelled `autonode: "true"`, which only
AutoNode creates, so its pod stays Pending until AutoNode launches a node:

```bash
oc new-project autonode-demo
oc apply -f stress-test.yaml -n autonode-demo
```

### 6. Observe results

* **Pod scheduling:** `oc get pods -n autonode-demo -w`
* **Node provisioning:** `oc get nodeclaims -w` and `oc get nodes -l autonode=true`

A NodeClaim appears straight away; the node joins and the pod is Running about
five minutes later.

### 7. Clean Up

Remove the workload, and AutoNode removes the node it launched once it is empty:

```bash
oc delete project autonode-demo
oc get nodeclaims -w
```

`nodepool.yaml` sets a disruption budget of zero nodes on weekdays from 09:00 for
8 hours (UTC): during that window AutoNode does not remove nodes, even empty
ones, so the node stays until the window ends. Edit or remove that budget if you
want to show scale-down during the working day.

To remove AutoNode itself, delete the NodePool and NodeClass, then set
`deploy_autonode = false` and re-apply Terraform.

## Logs and Debugging
* **View NodePool status:** `oc describe nodepools.karpenter.sh ondemand-and-spot`
* **Check NodeClaim status:** `oc get nodeclaims`
* **Check NodeClass status:** `oc get openshiftec2nodeclass example-nodeclass -o yaml`
