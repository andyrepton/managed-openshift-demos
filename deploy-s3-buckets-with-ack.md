# Demo 1: Creating S3 buckets via the OpenShift API using ACK

## Before your demo
- Run `./create_demo.sh install_demo1`

## During your demo
1. Install ACK controller via console

2. Run the following commands:

```
$ aws s3 ls | grep hello-hcp

$ cat deploy-s3-buckets-with-ack/bucket.yaml

$ oc apply -f deploy-s3-buckets-with-ack/bucket.yaml

$ aws s3 ls | grep hello-hcp

$ oc delete bucket hello-hcp-bucket

$ aws s3 ls | grep hello-hcp
```
