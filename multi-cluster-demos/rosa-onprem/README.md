# Hybrid Cluster demo

## Ahead of time

- Ensure you have two clusters. Ideally these would be in two different namespaces

- Create your users:

```
oc config delete-context ${TF_VAR_cluster_name}-1
rosa create admin -c ${TF_VAR_cluster_name}-1
oc login... (from above)
# Ensure "Login successful" message
oc config rename-context $(oc config current-context) ${cluster_name}-1

oc config delete-context ${TF_VAR_cluster_name}-2
oc login $your_other_cluster
oc config rename-context $(oc config current-context) ${cluster_name}-2
```

## Fork the hello repo

- Go to https://github.com/andyrepton/hello and fork it to make your own copy

- Go into your github fork and browse to Settings -> Secrets and Variables -> Actions

- Enter the following variables on the secrets tab:

OCP_SERVER = The API URL of your on-prem server
OCP_TOKEN = The login token for your on-prem server
ROSA_SERVER = The API URL of your Cloud server
ROSA_TOKEN = The login token for your Cloud server
QUAY_TOKEN = Your token from Quay.io

- Go to the Variables tab and set the following:

ONPREM_LIVE = true
ROSA_LIVE = true

- Edit the .github/workflows/openshift.yml file to point at your quay repository (you'll need to make it first)

- Run the github actions and the app will be deployed to both. The openshift.yml github action is reasonably easy to read
