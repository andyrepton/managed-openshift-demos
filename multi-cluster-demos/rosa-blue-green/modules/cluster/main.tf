data "aws_caller_identity" "current" {}

module "rosa_hcp" {
  source  = "terraform-redhat/rosa-hcp/rhcs"
  version = "1.7.4"

  cluster_name           = var.cluster_name
  openshift_version      = var.openshift_version
  aws_subnet_ids         = var.aws_subnet_ids
  aws_availability_zones = var.aws_availability_zones
  private                = var.private
  replicas               = var.replicas
  compute_machine_type   = var.compute_machine_type

  create_oidc           = true
  create_account_roles  = true
  create_operator_roles = true
  account_role_prefix   = var.cluster_name
  operator_role_prefix  = var.cluster_name

  upgrade_acknowledgements_for = var.upgrade_acknowledgements_for

  machine_pools = {
    for k, pool in var.machine_pools : k => {
      name              = pool.name
      openshift_version = var.openshift_version
      subnet_id         = pool.subnet_id
      replicas          = pool.replicas
      autoscaling       = pool.autoscaling
      labels            = pool.labels
      auto_repair       = pool.auto_repair
      taints            = pool.taints
      aws_node_pool = {
        instance_type = pool.instance_type
        tags          = pool.aws_tags
      }
    }
  }

  tags = var.tags
  properties = {
    rosa_creator_arn = data.aws_caller_identity.current.arn
  }
}
