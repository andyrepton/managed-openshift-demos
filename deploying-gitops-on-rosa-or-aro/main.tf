# Install ROSA in default mode

module "rosa-cluster" {
  #source = "github.com/rh-mobb/terraform_rhcs_rosa_sts//rosa_sts_managed_oidc"
  source = "../../../terraform_ocm_rosa_sts/rosa_sts_managed_oidc"
  create_vpc = true
  private_cluster = false
  admin_username = var.admin_username
  admin_password = var.admin_password
  cluster_name = "poc-andyr"
}

resource "time_sleep" "wait_30_seconds" {
  depends_on = [module.rosa-cluster]

  create_duration = "30s"
}

resource "null_resource" "install-gitops" {
  provisioner "local-exec" {
    command = "bash ${path.module}/install-gitops.sh ${var.admin_username} ${var.admin_password} ${module.rosa-cluster.api_url}"
  }
  depends_on = [time_sleep.wait_30_seconds]
}

output api_url {
  value = module.rosa-cluster.api_url
}
