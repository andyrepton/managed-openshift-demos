# Demo of LokiStack on ROSA

This presenter-led demo builds OpenShift Logging with LokiStack step by step on
Red Hat OpenShift Service on AWS (ROSA). Starting from an S3 bucket and an AWS
role prepared for Loki, it creates a LokiStack, then a Vector collector that
forwards infrastructure logs with the OpenShift console as the viewer, and
finally adds application logs from a chosen namespace. The audience sees
infrastructure and then application logs arrive in the console. It is here to
show that logging on ROSA can be customised and kept in the customer's own S3
storage, with no AWS keys on the cluster.

Tested: 2026-11-04, ROSA HCP 4.22.12, Logging 6.6.2, Loki Operator 6.6.2, Cluster Observability Operator 1.5.4. Logs checked through the LokiStack gateway; the console's Logs view was enabled but not looked at by a person.

## Prerequisites

* A ROSA cluster with LokiStack capacity, an S3 bucket and an IAM role for
  Loki: apply [andys-demo-cluster-tf](../andys-demo-cluster-tf) with
  `deploy_lokistack_machine_pool = true` (two m5.4xlarge nodes, the bucket and
  the role).
* [logging-operator-lokistack](../logging-operator-lokistack): the Logging and
  Loki operators.
* The Cluster Observability Operator, for the console's Logs view. If it is not
  installed yet:
  `oc apply -f ../demo-claude-via-open-source-models/cluster-setup/operators/cluster-observability-operator.yaml`.
* `oc` CLI with cluster-admin access, and `curl` and `jq` for the verify step.

## Ahead of time

Run these from this folder. Create the Secret that tells Loki which bucket and
role to use, from the Terraform outputs (run from the checkout that holds the
Terraform state). None of these values is a credential: Loki gets short-lived
AWS credentials by assuming the role with its own ServiceAccount token.

```bash
BUCKET=$(cd ../andys-demo-cluster-tf && terraform output -raw lokistack_bucket_name)
ROLE_ARN=$(cd ../andys-demo-cluster-tf && terraform output -raw lokistack_iam_role_arn)
AWS_REGION=<your-region>

oc -n openshift-logging create secret generic logging-loki-aws \
  --from-literal=bucketnames="$BUCKET" \
  --from-literal=region="$AWS_REGION" \
  --from-literal=audience=openshift \
  --from-literal=role_arn="$ROLE_ARN"
```

## During the demo

1. Talk about logging, and the ability to customise logging, forwarding and
   where logs are kept.

2. Create the LokiStack:

   ```bash
   oc apply -f lokistack-install.yaml
   ```

3. Show it coming up (one to three minutes until every component is Ready):

   ```bash
   oc get pods -n openshift-logging -l app.kubernetes.io/instance=logging-loki
   oc wait lokistack/logging-loki -n openshift-logging --for=condition=Ready --timeout=10m
   ```

4. Create the collector's ServiceAccount, then forward infrastructure logs and
   add the console's Logs view:

   ```bash
   oc apply -f collector.yaml
   oc apply -f cluster-log-store.yaml
   oc wait clusterlogforwarder/lokistack -n openshift-logging --for=condition=Ready --timeout=3m
   ```

5. Show the collector pods (one per node), then open **Observe > Logs** in the
   console (refresh the page once if the menu item has not appeared yet) and
   show the **infrastructure** logs:

   ```bash
   oc rollout status ds/lokistack -n openshift-logging --timeout=5m
   oc get pods -n openshift-logging -l app.kubernetes.io/instance=lokistack
   ```

6. Start a small application that logs a line every five seconds, then add
   application logs from its namespace, `logging-demo`:

   ```bash
   oc apply -f app.yaml
   oc apply -f cluster-log-forwarder.yaml
   ```

   It has to be an application namespace: the collector tags logs from any
   `openshift-*`, `kube-*` or `default` namespace as infrastructure, even
   through an application input.

7. Show the collector pods restarting with the new pipeline:

   ```bash
   oc get pods -n openshift-logging -l app.kubernetes.io/instance=lokistack
   oc rollout status ds/lokistack -n openshift-logging --timeout=5m
   ```

8. Go back to **Observe > Logs**, switch to **application** logs, and show the
   `logging-demo` lines (`order N processed for customer-M`) arriving within a
   minute.

## Verify

Without the console, count the log streams in each tenant through the
LokiStack gateway, as a cluster-admin. The token goes to `curl` on stdin:

```bash
GW=https://$(oc get route logging-loki -n openshift-logging -o jsonpath='{.spec.host}')
streams() {
  printf 'Authorization: Bearer %s\n' "$(oc whoami -t)" \
    | curl -s -G -H @- "$GW/api/logs/v1/$1/loki/api/v1/query_range" --data-urlencode "query=$2" \
    | jq -r --arg t "$1" '"\($t): \(.data.result | length) log streams"'
}
streams infrastructure '{log_type="infrastructure"}'
streams application '{kubernetes_namespace_name="logging-demo"}'
```

Both counts are above zero (the application one a minute or so after step 6).

## Clean Up

```bash
oc delete -f app.yaml
oc delete -f cluster-log-store.yaml
oc delete -f collector.yaml
oc delete -f lokistack-install.yaml
oc delete secret logging-loki-aws -n openshift-logging
oc delete pvc -n openshift-logging -l app.kubernetes.io/instance=logging-loki
```

The logs already written stay in the S3 bucket until Terraform removes it.
Leave the `openshift-logging` namespace in place: ROSA created it, and other
logging demos use it.
