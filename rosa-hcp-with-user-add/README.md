# Terraform plan to make a ROSA HCP cluster with admin user

This Terraform configuration builds a ready-to-use Red Hat OpenShift Service on
AWS (ROSA) cluster with hosted control planes in one `terraform apply`. It
optionally creates a VPC, creates the ROSA account roles, operator roles and
OIDC provider, then the cluster and an htpasswd identity provider with a user in
the cluster-admin group, so you can log in as soon as the cluster is up without
separate `rosa` CLI steps. It is here as a simple, repeatable way to build a
single demo cluster with infrastructure as code.

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
