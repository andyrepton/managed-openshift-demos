# Model as a Service (MaaS) on ROSA

This demo shows Model as a Service (MaaS) on Red Hat OpenShift Service on AWS
(ROSA) from a consumer's point of view. Two Jupyter notebooks create a
time-limited API key for a subscription tier, list the models it can use, and
send chat completion requests to an OpenAI-compatible endpoint, one against a
GPT OSS 20B model and one against a simulator. Teams can use self-hosted models
through a familiar API with per-key access control. It is here to show ROSA
running shared, governed model endpoints for internal users. It assumes MaaS is
already deployed.

Tested: 2026-11-04, ROSA HCP 4.22.12, RHOAI 3.5.2, in an OpenShift AI workbench created by a person in the dashboard (notebook uploaded rather than cloned; simulator notebook not tested).

## Overview

* **MaaS API** -- An OpenAI-compatible model-serving endpoint running on ROSA, providing API key management and chat completions.
* **Two notebooks** -- `oss-gpt-demo.ipynb` (GPT OSS 20B model, `gpt-oss-20b-premium` subscription) and `simulator-demo.ipynb` (simulator model, `simulator-premium` subscription).
* **Three-step workflow** -- (1) Generate an API key, (2) List available models and extract the serving URL, (3) Submit chat completion requests.

## Prerequisites

* A ROSA cluster with OpenShift AI Models-as-a-Service (MaaS) and at least one
  model, for example from
  [`../demo-claude-via-open-source-models/`](../demo-claude-via-open-source-models/)
  (this README uses its `claude-code-demo-subscription` and `claude-code-demo-auth`).
* `oc` logged in as a cluster administrator, to grant the workbench access.

The notebooks run in an OpenShift AI workbench inside the cluster and
authenticate as the workbench's ServiceAccount, so nothing runs on your laptop.

## How to Run the Demo

### 1. Create a workbench

In the OpenShift AI dashboard (`https://rh-ai.<cluster-domain>`):

1. **Projects > Create project**, for example `maas-notebook-demo`.
2. **Create workbench** in it, for example `maas-demo`, with a standard Jupyter
   data science image, size Small, and these **environment variables**:
   * `MAAS_URL`: the MaaS hostname, `maas.<cluster-domain>`
   * `MAAS_SUBSCRIPTION`: the subscription to create a key for, for example
     `claude-code-demo-subscription`
   * `MAAS_MODEL`: the model to call, for example
     `publishers/claude-code-demo/models/qwen3-8-27b`. Without it the notebook
     uses the first model listed, which your key may not be allowed to use.
3. **Open** the workbench and clone this repository (**Git > Clone a
   Repository**), or upload the notebook.

### 2. Allow the workbench to use MaaS

The workbench runs as a ServiceAccount named after it. Add it to the
subscription and its auth policy:

```bash
SA_USER="system:serviceaccount:maas-notebook-demo:maas-demo"
oc patch maassubscription claude-code-demo-subscription -n models-as-a-service \
  --type merge -p "{\"spec\":{\"owner\":{\"users\":[\"$SA_USER\"]}}}"
oc patch maasauthpolicy claude-code-demo-auth -n models-as-a-service \
  --type merge -p "{\"spec\":{\"subjects\":{\"users\":[\"$SA_USER\"]}}}"
```

These replace any `users` already listed there; add them to the list if you
have some. MaaS caches subscription owners, so the first key request can fail
with `Unable to resolve a subscription` for about 90 seconds.

### 3. Run the notebook

Open `demo-maas-on-rosa/notebooks/oss-gpt-demo.ipynb` and run the cells in
order:

1. **Generate API Key**: creates a one-hour MaaS API key with the workbench's
   ServiceAccount token.
2. **List Models**: queries `/v1/models` and picks `MAAS_MODEL`.
3. **Chat Completion**: sends a prompt to `/v1/chat/completions` and prints the
   response, including the model's reply and token usage.

`notebooks/simulator-demo.ipynb` is the same notebook with a different default
subscription (`simulator-premium`), for MaaS setups that have a simulator model.

## Notes

* The notebooks verify the MaaS route's TLS certificate. On ROSA the default
  ingress certificate is publicly trusted, so no extra setup is needed.
* `MAAS_URL` is required: the notebooks stop with an error if it is not set.
* Set `OC_TOKEN` to use another OpenShift token instead of the workbench's
  ServiceAccount token, for example to run the notebook outside the cluster.

## Clean Up

The API keys expire after an hour. Remove the workbench's access and its
project:

```bash
oc patch maassubscription claude-code-demo-subscription -n models-as-a-service \
  --type json -p '[{"op": "remove", "path": "/spec/owner/users"}]'
oc patch maasauthpolicy claude-code-demo-auth -n models-as-a-service \
  --type json -p '[{"op": "remove", "path": "/spec/subjects/users"}]'
oc delete project maas-notebook-demo
```
