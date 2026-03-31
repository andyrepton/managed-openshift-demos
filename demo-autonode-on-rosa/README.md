# ROSA AutoNode Demo (Karpenter-based Scaling)

This demo demonstrates **AutoNode**, the autoscaling solution for Red Hat OpenShift Service on AWS (ROSA) with Hosted Control Planes (HCP). 

By utilizing **Karpenter** logic, AutoNode moves away from static MachineSets, allowing the cluster to provision nodes based on actual pod requirements. This improves scaling speed and cost efficiency by selecting the most appropriate AWS instance types dynamically.

## Overview
* **Infrastructure as Code:** Uses Terraform to provision the ROSA HCP cluster and the necessary IAM roles for AutoNode.
* **Declarative Node Configuration:** Uses `OpenShiftEC2NodeClass` and `NodePool` resources to define how AWS infrastructure should be provisioned.
* **Dynamic Scaling:** Watches for pending pods and provisions the "right-sized" EC2 instances in real-time.

## Prerequisites
* A ROSA HCP cluster.
* AWS CLI, `rosa` CLI, and `oc` CLI installed.
* Terraform CLI installed.

## How to run the demo

### 1. Provision the Infrastructure

Navigate to the `rosa-terraform` directory and deploy the cluster and IAM requirements.

```bash
cd rosa-terraform
terraform init
terraform apply

CLUSTER_ID=$(terraform output -raw cluster_id)
AUTONODE_ROLE_ARN=$(terraform output -raw autonode_role_arn)
```

**Important:** From the Terraform output, note the `autonode_iam_role_arn` and your `cluster_id`.

### 2. Tag the Security Groups and Subnets as required


**Important**, this is designed for ZShell, if you are using bash, edit this!

```bash
SECURITY_GROUP_IDS=(${(z)$(aws ec2 describe-security-groups \
    --filters "Name=tag:Name,Values=$CLUSTER_ID-default-sg" \
    --query 'SecurityGroups[*].GroupId' \
    --output text)})

PRIVATE_SUBNET_IDS=(${(z)$(aws ec2 describe-subnets \
    --filters "Name=tag:kubernetes.io/cluster/$CLUSTER_ID,Values=shared" \
    --query 'Subnets[*].SubnetId' \
    --output text)})

aws ec2 create-tags \
        --resources "${SECURITY_GROUP_IDS[@]}" "${PRIVATE_SUBNET_IDS[@]}" \
        --tags Key="karpenter.sh/discovery",Value="$CLUSTER_ID"
```

**Important**: make sure that your aws cli is configured to use `us-east-1`, otherwise the above subnets and security group won't be found!

### 3. Enable AutoNode Feature

Enable the AutoNode capability on your ROSA cluster using the ARN from the previous step:

```bash
rosa edit cluster --cluster <your_cluster_id> --autonode=enabled --autonode-iam-role-arn=<arn_from_terraform_output>
```

### 4. Configure the NodeClass

The `OpenShiftEC2NodeClass` tells AutoNode which AWS subnets and security groups to use. 

First, set your environment variable (using the ID from your terraform output):

```bash
export CLUSTER_ID=<your_cluster_id_from_terraform_output>
```

Now, apply the configuration using the template provided in the repo:
```bash
sed "s/CLUSTER_ID/$CLUSTER_ID/g" openshiftec2nodeclass.tmpl > openshiftec2nodeclass.yaml

oc apply -f openshiftec2nodeclass.yaml
```

### 5. Create the NodePool

Apply the `nodepool.yaml` to define the constraints (like architecture or capacity type) for the nodes AutoNode will create:
```bash
oc apply -f nodepool.yaml
```

### 6. Deploy the Workload

Deploy the stress-test application to trigger the scaling logic:
```bash
oc apply -f stress-test.yaml
```

### 7. Observe Results

Monitor how the cluster responds to the resource demand:
* **Pod Scheduling:** `oc get pods -w`
* **Node Provisioning:** `oc get nodes -w`

### 8. Clean Up

To remove the demonstration workload and allow AutoNode to terminate the additional EC2 instances:

```bash
oc delete -f stress-test.yaml
```

## Logs and Debugging
* **AutoNode Controller Logs:** `oc logs -n kube-system -l app.kubernetes.io/name=karpenter`
* **View NodePool status:** `oc describe nodepool`
* **Check NodeClaim status:** `oc get nodeclaims`
