# Managed OpenShift Demos

This repository is aimed to provide examples of how to do several "solution based" demos with Managed OpenShift. Managed OpenShift is a version of OpenShift where the creation and management of the cluster itself is taken care of by the cloud provider and Red Hat, so the demos here are more designed around what is possible to be built on top of the cluster when management of it is removed.

This is an ever growing repo which will be added to when I have time! If you find bugs, please open an issue and I will do my best to resolve it swiftly. If you have suggestions or would like to contribute, please feel free to make a PR.

Thanks!

## Content

1. [Deploying S3 Buckets from OpenShift using the ACK (AWS Controllers for Kubernetes) Operators](#1-deploying-s3-buckets-from-openshift-using-the-ack-aws-controllers-for-kubernetes-operators)

    1.1 [Before your demo](#11-before-your-demo)

    1.2 [During your demo](#12-during-your-demo)

2. [Deploying an App with Service Mesh](#2-deploying-an-app-with-service-mesh)

    2.1 [Before your demo](#21-before-your-demo)

    2.2 [During your demo](#22-during-your-demo)

3. [Forwarding logs to AWS CloudWatch from a ROSA cluster](#3-forwarding-logs-to-aws-cloudwatch-from-a-rosa-cluster)

    3.1 [Before your demo](#31-before-your-demo)

    3.2 [During your demo](#32-during-your-demo)

4. [Forwarding metrics to AWS CloudWatch from a ROSA cluster](#4-forwarding-metrics-to-aws-cloudwatch-from-a-rosa-cluster)

    4.1 [Before your demo](#41-before-your-demo)

    4.2 [During your demo](#42-during-your-demo)

5. [Deploying OpenShift gitops onto a new ARO or ROSA cluster](#5-deploying-openshift-gitops-onto-a-new-aro-or-rosa-cluster)

6. WIP [6 Deploying RHACM onto a Managed OpenShift Cluster using the command line or via GitOps](#wip-6-deploying-rhacm-onto-a-managed-openshift-cluster-using-the-command-line-or-via-gitops)

7. WIP [7 Deploying OpenShift Service Mesh onto a Managed OpenShift Cluster using the command line or via GitOps](#wip-7-deploying-openshift-service-mesh-onto-a-managed-openshift-cluster-using-the-command-line-or-via-gitops)

8. WIP [8 Deploying OpenShift Interconnect (Skupper) onto a Managed OpenShift Cluster using the command line or via GitOps](#8-deploying-openshift-interconnect-skupper-onto-a-managed-openshift-cluster-using-the-command-line-or-via-gitops)

9. [Demonstrating developer productivity via Source2Image](#9-demonstrating-developer-productivity-via-source2image)

    9.1 [Before your demo](#91-before-your-demo)

    9.2 [During your demo](#92-during-your-demo)

10. WIP [10 Demonstrating the power of S2I to enable developers using dev spaces](#wip-10-demonstrating-the-power-of-s2i-to-enable-developers-using-dev-spaces)

    10.1 [Before your demo](#101-before-your-demo)

    10.2 [During your demo](#102-during-your-demo)

## 1 Deploying S3 Buckets from OpenShift using the ACK (AWS Controllers for Kubernetes) Operators

This demo only works on ROSA

### 1.1 Before your demo

- Run `./create_demo.sh install_demo1` from the root of the repo

### 1.2 During your demo

- Install ACK controller via console

- Run the following commands:

```bash
aws s3 ls | grep hello-hcp

cat deploy-s3-buckets-with-ack/bucket.yaml

oc apply -f deploy-s3-buckets-with-ack/bucket.yaml

aws s3 ls | grep hello-hcp

oc delete bucket hello-hcp-bucket

aws s3 ls | grep hello-hcp
```

## 2 Deploying an App with Service Mesh

### 2.1 Before your demo

Install service mesh by following the instructions in the `openshift-service-mesh` folder

##### 2.1.1 Manually Install

- Go to the openshift service mesh folder [here](../openshift-service-mesh/)
- Run

```bash
oc apply -f .
```

##### 2.1.2 GitOps

- Go to the gitops folder [here](../openshift-service-mesh/gitops/) and install gitops

```bash
oc apply -f gitops/
```

### 2.2 During your demo

Deploy the hello application

```bash
oc new-project hello
oc new-app https://github.com/andyrepton/hello
```

Create a service mesh role using the example here:

```bash
oc apply -f ../deploying-an-app-with-service-mesh/servicemeshroll.yaml
```

## 3 Forwarding logs to AWS CloudWatch from a ROSA cluster

This demo only works on ROSA

### 3.1 Before your demo

- Run `../create_demo.sh install_demo3`

### 3.2 During your demo

- Go to OpenShift Operators -> Cluster Logging Operator.

- Change project to OpenShift Logging

- Show that the OpenShift Logging Operator is installed already, explaining that this takes time to set up so you've already done that bit

- Run the following commands:

```
$ oc project openshift-logging

# Explain what the logforwarder is and how it works:
$ cat ../forward-logs-to-aws-cloudwatch/logforwarder.yaml

# Apply the forwarded:
$ oc apply -f ../forward-logs-to-aws-cloudwatch/logforwarder.yaml

# Show that logs have arrived:
$ aws logs describe-log-groups --log-group-name-prefix poc-andyr

# Get the name of a log stream:
$ aws logs describe-log-streams --log-group-name poc-andyr.audit | jq -r '.logStreams[0].logStreamName'

# Read the log using the output of the above command:
$ aws logs get-log-events --log-group-name poc-andyr.audit --log-stream-name $LOG_STREAM_NAME_HERE_FROM_LAST_STEP
```

## 4 Forwarding metrics to AWS CloudWatch from a ROSA cluster

This demo only works on ROSA

### 4.1 Before your demo

- Ensure you are logged into AWS!
- Run `./create_demo.sh install_demo2`

### 4.2 During your demo

- Explain the need for metrics in AWS.

- Show the empty dashboard in AWS (the setup script will spit out the dashboard link)

```bash
oc apply -f forward-metrics-to-aws-cloudwatch/cloud-watch.yaml

oc get pods -n amazon-cloudwatch

cat forward-metrics-to-aws-cloudwatch/dashboard.json

cat forward-metrics-to-aws-cloudwatch/dashboard.json | pbcopy
```

- Paste into your dashboard: Actions -> View/Edit Source and then paste

> Important! Remember that it'll take about 3.5 minutes from your deployment of the cloud watch agent until metrics start arriving, so perhaps move onto demo 3 during this time

## 5 Deploying OpenShift gitops onto a new ARO or ROSA cluster

Install the operator by running

```bash
oc apply -f ../openshift-gitops/gitops-install.yaml
```

## WIP 6 Deploying RHACM onto a Managed OpenShift Cluster using the command line or via GitOps

### Option 1: Manually

```bash
cd rhacm
oc apply -f .
```

Wait for the CRD to be installed, then run again (first run will lack the multi-cluster-hub CRD)

### Option 2: GitOps

- Go to the gitops folder [here](../openshift-gitops) and install gitops
- Create the application file in the gitops folder:

```bash
oc apply -f gitops/
```

## WIP 7 Deploying OpenShift Service Mesh onto a Managed OpenShift Cluster using the command line or via GitOps

Please see the [./openshift-service-mesh](./openshift-service-mesh) folder

## 8 Deploying OpenShift Interconnect (Skupper) onto a Managed OpenShift Cluster using the command line or via GitOps

### Option 1: Manually

```bash
oc apply -f .
```

Skupper will be installed in the openshift-operators namespace

### Option 2: GitOps

- Go to the gitops folder [here](../openshift-gitops) and install gitops
- Create the application file in the gitops folder:

```bash
oc apply -f gitops/
```

## 9 Demonstrating developer productivity via Source2Image

### 9.1 Before your demo
- Make sure you have a cluster available

### 9.2 During your demo
- Log onto your console

- Open up the developer view and click "Add"

- Paste the following URL: https://github.com/andyrepton/hello

- Show the OpenShift Builds and show that it creates a valid route

> The key here is that the repository does not have a Dockerfile, nor does it need one. Your developers can write their code and deploy onto OpenShift quickly and easily

## WIP 10 Demonstrating the power of S2I to enable developers using dev spaces

### 10.1 Before your demo
- Make sure you have a cluster available
- Install dev spaces (coming to this repo soon)

### 10.2 During your demo
- ?