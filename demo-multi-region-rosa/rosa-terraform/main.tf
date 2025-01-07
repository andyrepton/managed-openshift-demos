module "rosa1" {
  # Needed until https://github.com/terraform-redhat/terraform-rhcs-rosa-hcp/issues/60 is resolved
  providers = {
    aws = aws.west
  }
  count                         = 1
  source                        = "../../andys-demo-cluster-tf/rosa"
  create_vpc                    = true
  deploy_ai_machine_pool        = false
  deploy_graviton_machine_pool  = false
  deploy_lokistack_machine_pool = false
  deploy_virt_machine_pool      = false
  ack_service = ""
  private_cluster               = false
  cluster_name                  = "${var.cluster_name}-1"
  openshift_version             = var.openshift_version
}

module "rosa2" {
  # Needed until https://github.com/terraform-redhat/terraform-rhcs-rosa-hcp/issues/60 is resolved
  providers = {
    aws = aws.central
  }
  count                         = 1
  source                        = "../../andys-demo-cluster-tf/rosa"
  create_vpc                    = true
  deploy_ai_machine_pool        = false
  deploy_graviton_machine_pool  = false
  deploy_lokistack_machine_pool = false
  deploy_virt_machine_pool      = false
  ack_service = ""
  private_cluster               = false
  cluster_name                  = "${var.cluster_name}-2"
  openshift_version             = var.openshift_version
}
