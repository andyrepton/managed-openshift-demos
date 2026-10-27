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

### GPU clusters: check capacity before you apply

**Before setting `deploy_ai_machine_pool = true`, run the capacity scripts in
[`scripts/`](scripts/).** A GPU instance type is not offered in every
availability zone, and quota is not uniform across regions. Terraform does not
discover this for you: the machine pool API rejects the pool outright rather
than picking another zone, and the apply fails partway through with the rest
of the resources already created:

```
Error: Cannot create machine pool
Machine type 'g5.4xlarge' is not supported in availability zone
'eu-west-2c' for region 'eu-west-2'
```

```bash
cd scripts
./test-gpu-capacity-aws.sh eu-west-2 g5.4xlarge      # AWS: launches a real instance per AZ
./test-gpu-capacity-azure.sh westeurope Standard_NC40ads_H100_v5   # Azure: SKU/quota query
```

Feed the result back into two variables:

- `ai_gpu_instance_type`: a type the region actually offers.
- `ai_gpu_subnet_index`: the index into the VPC's private subnets, which
  selects the AZ. In `eu-west-2` index 0 is `eu-west-2a`, 1 is `eu-west-2b`
  and 2 is `eu-west-2c`. Confirm the mapping for your own cluster, since it
  depends on the subnet order the VPC module produced:

```bash
terraform state show 'module.rosa[0].module.vpc[0].aws_subnet.private[1]' | grep availability_zone
```

Note that `deploy_ai_machine_pool` creates **two** pools, not one: the GPU
pool and a separate `m5.4xlarge` RHOAI worker pool. Budget for both.

See [`scripts/README.md`](scripts/README.md) for the full usage.

### Changing a GPU machine pool's instance type or subnet

Both `instance_type` and `subnet_id` are **immutable** on a ROSA HCP machine
pool, but the RHCS provider does not mark them as requiring replacement. It
plans an in-place update that the API then rejects:

```
Error: Attribute value cannot be changed
Attribute aws_node_pool.subnet_id, cannot be changed from
"subnet-0f09..." to "subnet-0275..."
```

Force the replacement instead:

```bash
terraform apply -var-file=<your>.tfvars \
  -replace='module.rosa[0].module.rosa-rhoai-machine-pool[0].module.rosa-ai-machine-pool-gpu-pool.rhcs_hcp_machine_pool.machine_pool'
```

That still fails on the first attempt. ROSA will not reuse a node pool name
until the old node has drained **and** its EC2 instance has terminated, even
though the node pool already returns 404 from the API:

```
A NodePool with name 'poc-andyr1-gpu' is being deleted from cluster '...'.
Please retry the operation again later.
```

Wait for the node to disappear from `oc get nodes` and the instance to reach
`terminated`, then apply again. It took about 15 minutes.

Two things to settle **before** starting, because the destroy happens first
and is not reversible if the old type has no capacity:

- Check capacity for the *new* type with `scripts/test-gpu-capacity-aws.sh`,
  and check it for the old type too if you might want to go back.
- A GPU instance is not offered in every AZ, and EBS is zone-bound. Moving
  the pool to another AZ strands any PVC in the old one. Model weights have
  to be downloaded again into a new volume.

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
