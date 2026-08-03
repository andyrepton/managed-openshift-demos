# Model as a Service (MaaS) on ROSA

This demo showcases Red Hat's Model as a Service (MaaS) capability on ROSA, using Jupyter notebooks to generate API keys, discover available LLM models, and run chat completion requests through an OpenAI-compatible API.

## Overview

* **MaaS API** -- An OpenAI-compatible model-serving endpoint running on ROSA, providing API key management and chat completions.
* **Two notebooks** -- `oss-gpt-demo.ipynb` (GPT OSS 20B model, `gpt-oss-20b-premium` subscription) and `simulator-demo.ipynb` (simulator model, `simulator-premium` subscription).
* **Three-step workflow** -- (1) Generate an API key, (2) List available models and extract the serving URL, (3) Submit chat completion requests.

## Prerequisites

* A ROSA cluster with MaaS deployed.
* `oc` CLI installed and logged in to the cluster (used to obtain the authentication token).
* Python 3 with the `requests` library.
* A Jupyter notebook environment (local, or an OpenShift AI workbench).

## How to Run the Demo

### 1. Set the MaaS URL

Set the `MAAS_URL` environment variable to your MaaS endpoint:

```bash
export MAAS_URL=maas.apps.rosa.<your-cluster>.<your-domain>
```

### 2. Open a Notebook

Launch Jupyter and open one of the notebooks:

* **`notebooks/oss-gpt-demo.ipynb`** -- For the GPT OSS 20B model.
* **`notebooks/simulator-demo.ipynb`** -- For the simulator model.

### 3. Run the Cells Sequentially

Each notebook follows the same three-step pattern:

1. **Generate API Key** -- Authenticates with your `oc` token and creates a time-limited API key for the selected subscription tier.
2. **List Models** -- Queries `/v1/models` to discover available models and extract the serving URL.
3. **Chat Completion** -- Sends a prompt to `/v1/chat/completions` and displays the response.

### 4. Observe Results

The final cell prints the full API response including the model's reply, token usage, and metadata.

## Notes

* The notebooks use `verify=False` for SSL -- appropriate for demo environments with self-signed certificates.
* The `MAAS_URL` defaults to a hardcoded cluster URL if the environment variable is not set. Make sure to override it for your environment.
* The `oc whoami -t` command is used to dynamically obtain the OpenShift authentication token.

## Clean Up

No persistent resources are created. The API keys are time-limited (1 hour) and expire automatically.
