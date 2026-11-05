# IAM role for the ACK S3 controller (demo-deploy-s3-buckets-with-ack), assumed through the cluster's OIDC provider by one
# ServiceAccount (IRSA), so no AWS access keys are stored on the cluster.

data "rhcs_cluster_rosa_hcp" "ack_s3" {
  count = var.deploy_ack_s3 ? 1 : 0
  id    = module.rosa-hcp.cluster_id
}

locals {
  ack_s3_oidc_url = var.deploy_ack_s3 ? replace(data.rhcs_cluster_rosa_hcp.ack_s3[0].sts.oidc_endpoint_url, "https://", "") : ""
}

resource "aws_iam_role" "ack_s3" {
  count = var.deploy_ack_s3 ? 1 : 0
  name  = "${local.cluster_name}-ack-s3"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Federated = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:oidc-provider/${local.ack_s3_oidc_url}"
      }
      Action = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "${local.ack_s3_oidc_url}:sub" = "system:serviceaccount:ack-system:ack-s3-controller"
          "${local.ack_s3_oidc_url}:aud" = ["openshift", "sts.amazonaws.com"]
        }
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ack_s3" {
  count      = var.deploy_ack_s3 ? 1 : 0
  role       = aws_iam_role.ack_s3[0].name
  policy_arn = "arn:aws:iam::aws:policy/AmazonS3FullAccess"
}

output "ack_s3_iam_role_arn" {
  value       = var.deploy_ack_s3 ? aws_iam_role.ack_s3[0].arn : ""
  description = "IAM role ARN for the ACK S3 controller."
}
