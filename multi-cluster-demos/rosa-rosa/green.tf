# Install ROSA in default mode

module "rosa-cluster-green" {
  source = "github.com/rh-mobb/terraform_rhcs_rosa_sts//rosa_sts_managed_oidc"
  create_vpc = true
  private_cluster = false
  admin_username = var.admin_username
  admin_password = var.admin_password
  cluster_name = "poc-andyr-green"
  aws_region = "us-east-2"
  rosa_openshift_version = var.green_rosa_openshift_version 
}
