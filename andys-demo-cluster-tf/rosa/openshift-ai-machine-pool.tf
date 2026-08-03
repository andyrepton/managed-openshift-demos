module "rosa-rhoai-machine-pool" {
  count             = var.deploy_ai_machine_pool ? 1 : 0
  source            = "./modules/openshift-ai"
  cluster_id        = module.rosa-hcp.cluster_id
  cluster_name      = local.cluster_name
  openshift_version = var.openshift_version
  tags              = var.default_aws_tags
  subnet_id         = module.vpc[0].private_subnets[0]
  aws_region        = var.aws_region
}

output "aws_iam_access_key" {
  value = var.deploy_ai_machine_pool ? module.rosa-rhoai-machine-pool[0].aws_iam_access_key : ""
}

output "aws_iam_secret_key" {
  value = var.deploy_ai_machine_pool ? module.rosa-rhoai-machine-pool[0].aws_iam_secret_key : ""
}
