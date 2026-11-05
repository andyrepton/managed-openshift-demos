# Deploy S3 Buckets with AWS Controllers for Kubernetes (ACK)

This demo creates an Amazon S3 bucket from inside a Red Hat OpenShift Service on
AWS (ROSA) cluster using AWS Controllers for Kubernetes (ACK). After installing
the ACK S3 controller and giving it an IAM role, you apply a `Bucket` custom
resource with `oc apply`, and ACK creates and then manages the bucket in AWS.
Teams can declare the cloud resources their applications need as Kubernetes
YAML, next to the applications themselves. It is here to show ROSA acting as a
control plane for native AWS services as well as for containers.

Tested: 2026-11-05, ROSA HCP 4.22.12, ACK S3 controller 1.13.1 (including Clean Up, then a clean replay).

## Overview

* **ACK S3 controller**: watches `Bucket` custom resources and creates and
  manages the matching S3 buckets in AWS.
* **Declarative workflow**: the bucket is a YAML manifest (`bucket.yaml`)
  applied with `oc apply`, in a team's own namespace.
* **No AWS keys on the cluster**: the controller assumes an IAM role with its
  ServiceAccount token (IRSA), the same way ROSA's own operators reach AWS.

## Prerequisites

* A ROSA cluster with the controller's IAM role: apply
  [andys-demo-cluster-tf](../andys-demo-cluster-tf) with
  `deploy_ack_s3 = true`. The role trusts only the `ack-s3-controller`
  ServiceAccount in `ack-system` and has `AmazonS3FullAccess`.
* `oc` CLI with cluster-admin access, and the AWS CLI for the verify step.

## How to Run the Demo

Run these from this folder.

### 1. Configure and install the ACK S3 controller

The controller reads its settings from a ConfigMap that must exist before it
starts, and gets its IAM role through the Subscription. The role ARN comes from
the Terraform output (run from the checkout that holds the Terraform state):

```bash
AWS_REGION=<your-region>
ROLE_ARN=$(cd ../andys-demo-cluster-tf && terraform output -raw ack_s3_iam_role_arn)

oc create namespace ack-system
sed "s/AWS_REGION: REPLACE_ME/AWS_REGION: ${AWS_REGION}/" user-config.yaml | oc apply -f -
sed "s#ROLE_ARN_REPLACE_ME#${ROLE_ARN}#" operator.yaml | oc apply -f -

until oc get csv -n ack-system 2>/dev/null | grep ack-s3-controller | grep -q Succeeded; do sleep 10; done
oc get pods -n ack-system
```

The controller pod is `Running` with no restarts. This is a community operator
(`community-operators` catalog), not supported by Red Hat.

### 2. Create the S3 bucket

Bucket names are global across every AWS account, so the name is built from
your cluster name:

```bash
CLUSTER_NAME=<your-cluster-name>

sed "s/BUCKET_NAME_REPLACE_ME/${CLUSTER_NAME}-ack-demo/" bucket.yaml | oc apply -f -
oc wait bucket/hello-bucket -n ack-demo --for=condition=ACK.ResourceSynced --timeout=3m
```

### 3. Verify

```bash
oc get buckets -n ack-demo
aws s3api head-bucket --bucket "${CLUSTER_NAME}-ack-demo"
aws s3api get-bucket-tagging --bucket "${CLUSTER_NAME}-ack-demo" --output text
```

The bucket exists in AWS, tagged with the ACK controller version and the
namespace (`ack-demo`) that asked for it.

## Clean Up

Deleting the `Bucket` resource deletes the bucket in AWS (it must be empty):

```bash
oc delete bucket hello-bucket -n ack-demo
oc delete namespace ack-demo
oc delete subscription ack-s3-controller -n ack-system
oc delete csv -n ack-system \
  "$(oc get csv -n ack-system -o name | grep ack-s3-controller | cut -d/ -f2)"
oc delete namespace ack-system
```

Then set `deploy_ack_s3 = false` and re-apply Terraform to remove the IAM role.
