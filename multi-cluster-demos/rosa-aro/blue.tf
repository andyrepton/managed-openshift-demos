# Install ROSA in default mode

module "rosa-cluster-blue" {
  source = "github.com/rh-mobb/terraform_rhcs_rosa_sts//rosa_sts_managed_oidc"
  create_vpc = true
  private_cluster = false
  admin_username = var.admin_username
  admin_password = var.admin_password
  cluster_name = "poc-andyr-blue"
  aws_region = "eu-west-1"
  rosa_openshift_version = var.blue_rosa_openshift_version 
}
