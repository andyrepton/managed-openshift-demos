module "rosa-lokistack-machine-pool" {
  count             = var.deploy_lokistack_machine_pool ? 1 : 0
  source            = "./modules/lokistack"
  cluster_id        = module.rosa-hcp.cluster_id
  cluster_name      = local.cluster_name
  openshift_version = var.openshift_version
  tags              = var.default_aws_tags
  subnet_id         = module.vpc[0].private_subnets[0]
  aws_region        = var.aws_region
}
