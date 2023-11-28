# Demo 3: Forwarding logs from ROSA to CloudWatch

## Before your demo

- Run `./create_demo.sh install_demo3`

## During your demo

1. Go to OpenShift Operators -> Cluster Logging Operator.
2. Change project to OpenShift Logging
3. Show that the OpenShift Logging Operator is installed already, explaining that this takes time to set up so you've already done that bit
4. Run the following commands:

```
$ oc project openshift-logging

# Explain what the logforwader is and how it works:
$ cat forward-logs-to-aws-cloudwatch/logforwarder.yaml

# Apply the forwarded:
$ oc apply -f forward-logs-to-aws-cloudwatch/logforwarder.yaml

# Show that logs have arrived:
$ aws logs describe-log-groups --log-group-name-prefix poc-andyr

# Get the name of a log stream:
$ aws logs describe-log-streams --log-group-name poc-andyr.audit | jq -r '.logStreams[0].logStreamName'

# Read the log using the output of the above command:
$ aws logs get-log-events --log-group-name poc-andyr.audit --log-stream-name $LOG_STREAM_NAME_HERE_FROM_LAST_STEP
```
