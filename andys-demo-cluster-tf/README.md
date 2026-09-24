# Andys Demo cluster

This is an "all in one" setup to make demo clusters of managed OpenShift. When you type Terraform init/apply you will be asked a bunch of questions, depending on what you want to make.

If you want to skip these questions, the variables in question are:

### Required variables

```
# For ROSA/OSD
$RHCS_TOKEN
$TF_VAR_tags

# For ARO
TF_VAR_subscription_id
```

### Optional variables

```
$TF_VAR_cluster_name
$TF_VAR_aws_region (ROSA)
$TF_VAR_location (ARO)
$TF_VAR_domain (ARO)
$TF_VAR_deploy_lokistack_machine_pool
$TF_VAR_deploy_graviton_machine_pool (only for ROSA)
$TF_VAR_deploy_ai_machine_pool
$TF_VAR_deploy_virt_machine_pool (only for ROSA)
```

### GCP API prerequisites (OSD on GCP)

The following APIs must be enabled in the GCP project before creating an OSD cluster:

```
gcloud services enable \
  deploymentmanager.googleapis.com \
  networksecurity.googleapis.com \
  orgpolicy.googleapis.com \
  iap.googleapis.com \
  --project=<your-gcp-project-id>
```

### OSD on GCP: two-phase apply

The OSD module uses the `osd-wif-gcp` module to provision GCP-side WIF (Workload Identity Federation) resources. Because the module's `for_each` keys depend on the OCM blueprint (which is only available after the WIF config is created), a two-phase apply is required:

```bash
# Phase 1: Create the WIF config in OCM
terraform apply -var-file=<your>.tfvars -target='module.osd[0].osdgoogle_wif_config.wif'

# Phase 2: Create GCP IAM resources and the cluster
terraform apply -var-file=<your>.tfvars -target='module.osd[0]'
```

Subsequent applies (after the WIF config exists in state) can run without `-target`.

The `openshift_version` field on the WIF config is important: it tells OCM to return a version-specific IAM permissions blueprint. Without it, the generic blueprint may be missing permissions required by the installer (e.g. `compute.diskTypes.get`).

### ARO HCP post-install: global pull secret

After the ARO HCP cluster is created, you must add a global pull secret for operator content and Red Hat registry access. Follow the steps at:
https://learn.microsoft.com/en-us/azure/openshift/how-to-add-pull-secrets

### ARO HCP: node pool deletions

ARO HCP node pool deletions can be extremely slow (20-90+ minutes). If you need to tear down an ARO HCP cluster quickly, delete the Azure resource group directly rather than waiting for terraform to delete individual node pools:

```bash
az group delete --name <resource-group-name> --yes --no-wait
```

Then remove the resources from terraform state.

## Usage:

```
terraform init
terraform apply
```
