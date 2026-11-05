module "rosa-cloudwatch-metrics" {
  count        = var.deploy_cloudwatch_metrics ? 1 : 0
  source       = "./modules/cloudwatch-metrics"
  cluster_id   = module.rosa-hcp.cluster_id
  cluster_name = local.cluster_name
}

# The role was first created outside a module; keep it rather than replace it.
moved {
  from = aws_iam_role.cloudwatch_metrics[0]
  to   = module.rosa-cloudwatch-metrics[0].aws_iam_role.this
}

moved {
  from = aws_iam_role_policy_attachment.cloudwatch_metrics[0]
  to   = module.rosa-cloudwatch-metrics[0].aws_iam_role_policy_attachment.this
}

output "cloudwatch_metrics_iam_role_arn" {
  value       = var.deploy_cloudwatch_metrics ? module.rosa-cloudwatch-metrics[0].iam_role_arn : ""
  description = "IAM role ARN for the CloudWatch agent."
}
