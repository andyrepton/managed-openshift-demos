module "rosa-virt-machine-pool" {
  count   = var.deploy_virt_machine_pool ? 1 : 0
  source  = "terraform-redhat/rosa-hcp/rhcs//modules/machine-pool"
  version = "1.7.5"

  cluster_id        = module.rosa-hcp.cluster_id
  name              = "${local.cluster_name}-virt"
  openshift_version = var.openshift_version

  labels = merge({ node_type = "metal" }, var.deploy_bgp ? { bgp_router = "true" } : {})

  aws_node_pool = {
    instance_type = "m5.metal"
    tags          = merge(var.default_aws_tags, var.deploy_bgp ? { bgp_router = "true" } : {})
    additional_security_group_ids = var.deploy_bgp && var.create_vpc ? [
      aws_security_group.bgp_rfc1918[0].id,
      aws_security_group.bgp_allow_all[0].id,
    ] : null
  }

  subnet_id = local.private_subnet_id
  autoscaling = {
    enabled      = false
    min_replicas = null
    max_replicas = null
  }
  replicas = 1
}
