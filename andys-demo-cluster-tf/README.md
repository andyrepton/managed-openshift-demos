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

## Usage:

```
terraform init
terraform apply
```
