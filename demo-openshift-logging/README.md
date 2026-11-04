# Demo of Lokistack on ROSA

This presenter-led demo builds OpenShift Logging with LokiStack step by step on
Red Hat OpenShift Service on AWS (ROSA). Starting from an S3 bucket and AWS
roles prepared for Loki, it creates a LokiStack, then a logging instance with
Vector collectors and the OpenShift console as the viewer, and finally forwards
application logs from a chosen namespace. The audience sees infrastructure and
then application logs arrive in the console. It is here to show that logging on
ROSA can be customised and kept in the customer's own S3 storage.

## Ahead of time

- Ensure you've built a cluster than has lokistack capacity, a bucket for loki to use, and the loki AWS roles set up. You can use the terraform in ../andys-demo-cluster-tf to achieve this 

- Clean up your existing demo:

```
$ oc delete namespace openshift-logging
```

- Install OpenShift logging Operator and Loki Operator by following the instructions here: https://cloud.redhat.com/experts/o11y/openshift-logging-lokistack/

## During the demo

- Talk about logging, and the ability to customise logging, forwarding etc.

- Create a new LokiStack using the following:

```
oc create -f lokistack-install.yaml
```

- Show the Lokistack being created:

```
oc get pods -n openshift-logging
```

- Now make a Cluster Log Store:

```
oc create -f cluster-log-store.yaml
```

- Show the cluster collectors have been created, and show the logging in the console

- Now make a ClusterLogForwarder showing application logs:

```
oc create -f cluster-log-forwarder.yaml
```

- Show the pods restarting

- Now go back to the log in the console and show application logs now arriving
