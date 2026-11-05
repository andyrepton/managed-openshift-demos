module "rosa-lokistack-machine-pool" {
  count             = var.deploy_lokistack_machine_pool ? 1 : 0
  source            = "./modules/lokistack"
  cluster_id        = module.rosa-hcp.cluster_id
  cluster_name      = local.cluster_name
  openshift_version = var.openshift_version
  tags              = var.default_aws_tags
  subnet_id         = local.private_subnet_id
  aws_region        = var.aws_region
}

output "lokistack_bucket_name" {
  value       = var.deploy_lokistack_machine_pool ? module.rosa-lokistack-machine-pool[0].bucket_name : ""
  description = "S3 bucket for LokiStack."
}

output "lokistack_iam_role_arn" {
  value       = var.deploy_lokistack_machine_pool ? module.rosa-lokistack-machine-pool[0].iam_role_arn : ""
  description = "IAM role ARN for LokiStack."
}
