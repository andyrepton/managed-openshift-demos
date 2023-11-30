# Demos

## Content

1 [Deploying S3 Buckets from OpenShift using the ACK (AWS Controllers for Kubernetes) Operators](#1-deploying-s3-buckets-from-openshift-using-the-ack-aws-controllers-for-kubernetes-operators)
    1.1 

2 [Deploying an App with Service Mesh](#2-deploying-an-app-with-service-mesh)

3 [Forwarding logs to AWS CloudWatch from a ROSA cluster](#3-forwarding-logs-to-aws-cloudwatch-from-a-rosa-cluster)

4 [Forwarding metrics to AWS CloudWatch from a ROSA cluster](#4-forwarding-metrics-to-aws-cloudwatch-from-a-rosa-cluster)

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

Please see [./forward-metrics-to-aws-cloudwatch.md](./forward-metrics-to-aws-cloudwatch.md)

#### Deploying OpenShift gitops onto a new ARO or ROSA cluster

Please see the [./openshift-gitops](./openshift-gitops) folder

#### Deploying RHACM onto a Managed OpenShift Cluster using the command line or via GitOps

Please see the [./rhacm](./rhacm) folder

#### Deploying OpenShift Service Mesh onto a Managed OpenShift Cluster using the command line or via GitOps

Please see the [./openshift-service-mesh](./openshift-service-mesh) folder

#### Deploying OpenShift Interconnect (Skupper) onto a Managed OpenShift Cluster using the command line or via GitOps

Please see the [./rh-interconnect](./rh-interconnect) folder

#### Demonstrating developer productivity via Source2Image

Please see [./demonstrate-s2i.md](demonstrate-s2i.md)

The key here is that the repository does not have a Dockerfile, nor does it need one. Your developers can write their code and deploy onto OpenShift quickly and easily
