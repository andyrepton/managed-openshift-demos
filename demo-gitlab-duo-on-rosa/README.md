# Gitlab Duo on ROSA

## Prepare your ROSA cluster

1. You can use the code in ../andys-demo-cluster-tf to create a new ROSA cluster
2. Once you are logged in, proceed with the below instructions

## Install Gitlab

Gitlab will be used to host our Gitlab Duo setup, and is used as a place to store our code.

- Note: You will need a Gitlab license, and also a Gitlab Duo license to proceed with this demo. Contact Gitlab for more information

1. Browse to the gitlab folder and install the ingress class and the cert-manager operator:

```
cd gitlab
oc apply -f ingressclass.yaml
oc apply -f cert-manager-operator.yaml
```

2. Install the Gitlab Operator

```
oc apply -f gitlab-operator.yaml
```

3. Once installed, edit the gitlab.yaml to match your ROSA domain name, then apply it:

```
oc apply -f gitlab.yaml
```

4. Once installed, log in and install your license key, by browsing to Admin -> Subscription and put in the key. Once done, Gitlab Duo should show up on the left hand side

[!./images/gitlab-installed.png] 

## Install the Gitlab AI Gateway locally

1. Once Gitlab is installed, browse to Settings -> Network, and expand the Outbound Requests tab

2. Click the box marked "Allow requests to the local network from webhooks and integrations"

3. In the box, add `svc.cluster.local` like so, and click Save Changes:

[!./images/gitlab-allowed-requests.png]

4. Generate a private key to be used for jwt validation (keep this secret)

```
openssl genrsa -out duo_workflow_jwt.key 2048
```

5. Add the Helm repo and install the ai-gateway, replacing the gitlab duo domain as required:

```
helm repo add ai-gateway https://gitlab.com/api/v4/projects/gitlab-org%2fcharts%2fai-gateway-helm-chart/packages/helm/devel
helm repo update
helm upgrade --install ai-gateway \
  ai-gateway/ai-gateway \
  --version 0.5.0 \
  --namespace=ai-gateway \
  --set="image.tag=self-hosted-v18.5.0-ee" \
  --set="gitlab.url=https://gitlab.apps.rosa.poc-andyr.igwn.p3.openshiftapps.com/" \
  --set="gitlab.apiUrl=https://gitlab.apps.rosa.poc-andyr.igwn.p3.openshiftapps.com/api/v4/" \
  --set "extraEnvironmentVariables[0].name=DUO_WORKFLOW_SELF_SIGNED_JWT__SIGNING_KEY" \
  --set "extraEnvironmentVariables[0].value=$(cat duo_workflow_jwt.key)" \
  --timeout=300s --wait --wait-for-jobs
```

6. Return to the Admin Area in Gitlab, click on Gitlab Duo and click on "Change Configuration". At the bottom, under "Local AI Gateway URL" add `http://ai-gateway.ai-gateway.svc.cluster.local` and click "Save Changes"

7. The Health Check should report no problems like so:

[!./images/gitlab-health-check.png]

## Install OpenShift Service Mesh and Serverless operators

1. OpenShift AI uses OpenShift Serverless to host models inside the cluster. In order to get the CRDs for these, we need to install the operators. Browse to the openshift-servicemesh folder and install the operator:

```
cd openshift-service-mesh
oc apply -f subscription.yaml
```

2. Now install the openshift serverless operator

```
cd openshift-serverless
oc apply -f namespace.yaml
oc apply -f subscription.yaml
```

## Install OpenShift AI

For this demo, we will be running an LLM inside our OpenShift cluster. To handle this, we will be showing OpenShift AI's ability to host, tune and improve our model. You can also host LLMs inside OpenShift without the full setup of OpenShift AI if desired when tuning or adjustments are no longer needed.

1. Browse to the openshift-ai folder and install the OpenShift AI operator:

```
cd openshift-ai
oc apply -f namespace.yaml
oc apply -f subscription.yaml
```

2. Once installed, install the data science cluster operand:

```
oc apply -f data-science-cluster.yaml
```

## Install OpenShift DevSpaces

OpenShift DevSpaces allows developers to use an IDE in their browser, hosted inside the OpenShift cluster. We will connect DevSpaces to Gitlab Duo for code assistant capabilities.

1. Browse to the openshift-devspaces folder and install the DevSpaces operator:

```
cd openshift-devspaces
oc apply -f subscription.yaml
```

2. Once installed, install the Che cluster operand:

```
oc apply -f che-cluster.yaml
```

## Create a GPU node for your ROSA cluster

1. We will need a GPU to run our workload, so let's add one now:

```
rosa create machinepool -c $my_cluster_name --name=${my_cluster_name}-gpu --replicas=1 --interactive
```

2. Go through the prompts to select a valid GPU instance type. In this example, as I was in eu-west-1, I selected a p4d.24xlarge.

> WARNING: these GPU machines are extremely expensive to run for long periods of time. Please be aware of the costs before turning one of these on, and make sure you switch it off again after you are done!

3. If you need more time to finish up the cluster prep before turning this on, you can scale down your machine pool to be zero replicas to avoid paying the costs like so:

```
rosa edit machinepool -c $my_cluster_name --name=${my_cluster_name}-gpu --replicas=0
```

## Install the Node Feature Discovery operator

1. Browse to the gpu-operators folder and install the Node Feature Discovery operator:

```
cd gpu-operators
oc apply -f nfd-operator.yaml
```

2. Create an instance of the NodeFeatureDiscovery to find the details of the nodes:

```
oc apply -f nfd-instance.yaml
```

3. Install the NVIDIA GPU Operator:

```
oc apply -f namespace.yaml
oc apply -f nvidia-operator.yaml
```

4. Apply the NVIDIA Cluster Policy:

```
oc apply -f nvidia-cluster-policy.yaml
```

## Configure an LLM on OpenShift AI

1. Open OpenShift AI and browse to the Settings tab, then Accelerator Profiles. If the "nvidia" profile does not yet exist, make it like so:

[!./images/accelerator-profile.png]

2. Next, browse to Models -> Model Catalog and search for "Mistral". Select the Mistral-Small-3.1-24B-Instruct-2503 model

[!./images/model-catalog.png]



## Configure continue as a code assistant

1. Browse to the Extensions section of OpenShift DevSpaces once more

2. Search for "continue" and install the "Continue - open-source AI code agent" extension

3. Edit the config.yaml by adding the following:

```
name: Mistral Small 24b
version: 1.0.0
schema: v1
models:
  - uses: mistral-small-3-1-24b-raw
    apiBase: http://mistral-small-3-1-24b-raw-predictor.gitlab-duo.svc.cluster.local:8080/v1
```
