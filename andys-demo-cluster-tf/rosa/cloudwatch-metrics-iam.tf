# IAM role for the CloudWatch agent (demo-forward-metrics-to-aws-cloudwatch), assumed through the cluster's OIDC provider by one
# ServiceAccount (IRSA), so no AWS access keys are stored on the cluster.

data "rhcs_cluster_rosa_hcp" "cloudwatch_metrics" {
  count = var.deploy_cloudwatch_metrics ? 1 : 0
  id    = module.rosa-hcp.cluster_id
}

locals {
  cloudwatch_metrics_oidc_url = var.deploy_cloudwatch_metrics ? replace(data.rhcs_cluster_rosa_hcp.cloudwatch_metrics[0].sts.oidc_endpoint_url, "https://", "") : ""
}

resource "aws_iam_role" "cloudwatch_metrics" {
  count = var.deploy_cloudwatch_metrics ? 1 : 0
  name  = "${local.cluster_name}-cloudwatch-metrics"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Federated = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:oidc-provider/${local.cloudwatch_metrics_oidc_url}"
      }
      Action = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "${local.cloudwatch_metrics_oidc_url}:sub" = "system:serviceaccount:amazon-cloudwatch:cwagent-prometheus"
          "${local.cloudwatch_metrics_oidc_url}:aud" = ["openshift", "sts.amazonaws.com"]
        }
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "cloudwatch_metrics" {
  count      = var.deploy_cloudwatch_metrics ? 1 : 0
  role       = aws_iam_role.cloudwatch_metrics[0].name
  policy_arn = "arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy"
}

output "cloudwatch_metrics_iam_role_arn" {
  value       = var.deploy_cloudwatch_metrics ? aws_iam_role.cloudwatch_metrics[0].arn : ""
  description = "IAM role ARN for the CloudWatch agent."
}
