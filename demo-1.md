# Demo 1: Creating S3 buckets via the OpenShift API using ACK

## Before your demo

- Run `make create.demo1`

## During your demo
1. Install ACK controller via console

2. Run the following commands:

```
$ aws s3 ls | grep hello-hcp

$ cat demo1/bucket.yaml

$ oc apply -f demo1/bucket.yaml

$ aws s3 ls | grep hello-hcp

$ oc delete bucket hello-hcp-bucket

$ aws s3 ls | grep hello-hcp
```

## After your demo

- Run `make delete.demo1`
