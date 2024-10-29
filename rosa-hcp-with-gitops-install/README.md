# Terraform plan to make a ROSA HCP cluster with admin user
Creates:

- VPC and relevant stuff (optionally)
- ROSA Account Roles
- ROSA Operator Roles
- Managed OIDC provider
- ROSA HCP Cluster
- HTPasswd IDP with cluster-admin

## Usage:

- Export standard variables (optional):

```
export TF_VAR_default_aws_tags={"cost-center"="Foobar","service-phase"="lab","app-code"="Bar","owner"="arepton@redhat.com"}
export TF_VAR_cluster_name=poc-andyr
export TF_VAR_aws_region=eu-west-1
export RHCS_TOKEN=$my_token
```

- Build the cluster

```
terraform init
terraform apply
```
