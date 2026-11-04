# Deploy S3 Buckets with AWS Controllers for Kubernetes (ACK)

This demo creates an Amazon S3 bucket from inside a Red Hat OpenShift Service on
AWS (ROSA) cluster using AWS Controllers for Kubernetes (ACK). After installing
the ACK S3 controller and giving it AWS credentials, you apply a `Bucket` custom
resource with `oc apply`, and ACK creates and then manages the bucket in AWS.
Teams can declare the cloud resources their applications need as Kubernetes
YAML, next to the applications themselves. It is here to show ROSA acting as a
control plane for native AWS services as well as for containers.

## Overview

* **ACK S3 Controller** -- Watches for `Bucket` custom resources and creates/manages corresponding S3 buckets in AWS.
* **Declarative workflow** -- Define your S3 bucket as a YAML manifest (`bucket.yaml`) and apply it with `oc apply`.
* **Automated setup** -- The `create-demo.sh` script in the repository root automates IAM user creation, ACK controller installation, and bucket deployment.

## Prerequisites

* A ROSA cluster.
* AWS CLI configured with permissions to create IAM users and S3 buckets.
* `oc` CLI with cluster-admin access.
* `jq` installed.

## How to Run the Demo

### Option A: Automated Setup

From the repository root, run the setup script:

```bash
./create-demo.sh
```

Select **Demo 1 (ACK S3)** when prompted. The script will create the necessary IAM user, install the ACK S3 controller, and deploy the sample bucket.

### Option B: Manual Setup

#### 1. Install the ACK S3 Controller

Install the **AWS Controllers for Kubernetes - Amazon S3** operator from OperatorHub in the `ack-system` namespace.

#### 2. Configure AWS Credentials

Create an IAM user with `AmazonS3FullAccess` and configure the ACK controller with its credentials:

```bash
oc create secret generic aws-credentials \
  -n ack-system \
  --from-literal=AWS_ACCESS_KEY_ID=<YOUR_KEY> \
  --from-literal=AWS_SECRET_ACCESS_KEY=<YOUR_SECRET> \
  --from-literal=AWS_DEFAULT_REGION=<YOUR_REGION>
```

#### 3. Create the S3 Bucket

```bash
oc apply -f bucket.yaml
```

#### 4. Verify

```bash
oc get buckets
aws s3 ls | grep hello-hcp-bucket
```

## Clean Up

```bash
oc delete -f bucket.yaml
```

To also remove the ACK controller and IAM resources, run `./create-demo.sh` and select the clean option, or manually delete the operator subscription and IAM user.
