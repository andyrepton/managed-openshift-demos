module "rosa-ack-s3" {
  count        = var.deploy_ack_s3 ? 1 : 0
  source       = "./modules/ack-s3"
  cluster_id   = module.rosa-hcp.cluster_id
  cluster_name = local.cluster_name
}

# The role was first created outside a module; keep it rather than replace it.
moved {
  from = aws_iam_role.ack_s3[0]
  to   = module.rosa-ack-s3[0].aws_iam_role.this
}

moved {
  from = aws_iam_role_policy_attachment.ack_s3[0]
  to   = module.rosa-ack-s3[0].aws_iam_role_policy_attachment.this
}

output "ack_s3_iam_role_arn" {
  value       = var.deploy_ack_s3 ? module.rosa-ack-s3[0].iam_role_arn : ""
  description = "IAM role ARN for the ACK S3 controller."
}
