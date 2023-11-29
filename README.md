# Managed OpenShift Demos

This repository is aimed to provide examples of how to do several "solution based" demos with Managed OpenShift. Managed OpenShift is a version of OpenShift where the creation and management of the cluster itself is taken care of by the cloud provider and Red Hat, so the demos here are more designed around what is possible to be built on top of the cluster when management of it is removed.

This is an ever growing repo which will be added to when I have time! If you find bugs, please open an issue and I will do my best to resolve it swiftly. If you have suggestions or would like to contribute, please feel free to make a PR.

Thanks!

## Demos

### Deploying S3 Buckets from OpenShift using the ACK (AWS Controllers for Kubernetes) Operators

This demo only works on ROSA

Please see [./deploy-s3-buckets-with-ack.md](./deploy-s3-buckets-with-ack.md)

### Deploying an App with Service Mesh

Please note this is still a work in progress

Please see [./deploying-an-app-with-service-mesh.md](./deploying-an-app-with-service-mesh.md)

### Forwarding logs to AWS CloudWatch from a ROSA cluster

This demo only works on ROSA

Please see [./forward-logs-to-aws-cloudwatch.md](./forward-logs-to-aws-cloudwatch.md)

### Forwarding metrics to AWS CloudWatch from a ROSA cluster

This demo only works on ROSA

Please see [./forward-metrics-to-aws-cloudwatch.md](./forward-metrics-to-aws-cloudwatch.md)

### Deploying OpenShift gitops onto a new ARO or ROSA cluster

Please see the [./openshift-gitops](./openshift-gitops) folder

### Deploying RHACM onto a Managed OpenShift Cluster using the command line or via GitOps

Please see the [./rhacm](./rhacm) folder

### Deploying OpenShift Service Mesh onto a Managed OpenShift Cluster using the command line or via GitOps

Please see the [./openshift-service-mesh](./openshift-service-mesh) folder

### Deploying OpenShift Interconnect (Skupper) onto a Managed OpenShift Cluster using the command line or via GitOps

Please see the [./rh-interconnect](./rh-interconnect) folder

### Demonstrating developer productivity via Source2Image

Please see [./demonstrate-s2i.md](demonstrate-s2i.md)

The key here is that the repository does not have a Dockerfile, nor does it need one. Your developers can write their code and deploy onto OpenShift quickly and easily
