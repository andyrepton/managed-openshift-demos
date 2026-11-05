# IAM role for the ACK S3 controller (demo-deploy-s3-buckets-with-ack), assumed through the cluster's OIDC provider by one
# ServiceAccount (IRSA), so no AWS access keys are stored on the cluster.

data "aws_caller_identity" "current" {}

data "rhcs_cluster_rosa_hcp" "cluster" {
  id = var.cluster_id
}

locals {
  oidc_url = replace(data.rhcs_cluster_rosa_hcp.cluster.sts.oidc_endpoint_url, "https://", "")
}

resource "aws_iam_role" "this" {
  name = "${var.cluster_name}-ack-s3"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Federated = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:oidc-provider/${local.oidc_url}"
      }
      Action = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "${local.oidc_url}:sub" = "system:serviceaccount:${var.namespace}:${var.service_account}"
          "${local.oidc_url}:aud" = ["openshift", "sts.amazonaws.com"]
        }
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "this" {
  role       = aws_iam_role.this.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonS3FullAccess"
}

output "iam_role_arn" {
  value       = aws_iam_role.this.arn
  description = "IAM role ARN for the ACK S3 controller."
}
