# Demo 2: Forwarding metrics from ROSA to AWS CloudWatch

## Before your demo

- Ensure you are logged into AWS!
- Run `./create_demo.sh install_demo2`

## During your demo
1. Explain the need for metrics in AWS.

2. Show the empty dashboard in AWS (the setup script will spit out the dashboard link)

$ oc apply -f demo2/cloud-watch.yaml

$ oc get pods -n amazon-cloudwatch

$ cat demo2/dashboard.json

$ cat demo2/dashboard.json | pbcopy

Paste into your dashboard: Actions -> View/Edit Source and then paste

> Important! Remember that it'll take about 3.5 minutes from your deployment of the cloud watch agent until metrics start arriving, so perhaps move onto demo 3 during this time
