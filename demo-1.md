# Demo 1: Creating S3 buckets via the OpenShift API using ACK

## Before your demo
- Run `./create_demo.sh install_demo1`

## During your demo
1. Install ACK controller via console

2. Run the following commands:

```
$ aws s3 ls | grep hello-kubecon

$ cat demo1/bucket.yaml

$ oc apply -f demo1/bucket.yaml

$ aws s3 ls | grep hello-kubecon

$ oc delete bucket hello-kubecon-bucket

$ aws s3 ls | grep hello-kubecon
```
