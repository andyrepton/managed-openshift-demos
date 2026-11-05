module "rosa-autonode" {
  count              = var.deploy_autonode ? 1 : 0
  source             = "./modules/autonode"
  cluster_id         = module.rosa-hcp.cluster_id
  cluster_name       = local.cluster_name
  private_subnet_ids = local.private_subnet_ids
}

output "autonode_iam_role_arn" {
  value       = var.deploy_autonode ? module.rosa-autonode[0].iam_role_arn : ""
  description = "IAM role ARN for ROSA AutoNode."
}
