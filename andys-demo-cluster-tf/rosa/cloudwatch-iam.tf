data "rhcs_cluster_rosa_hcp" "cloudwatch" {
  count = var.deploy_cloudwatch_logging ? 1 : 0
  id    = module.rosa-hcp.cluster_id
}

locals {
  cloudwatch_oidc_url = var.deploy_cloudwatch_logging ? replace(data.rhcs_cluster_rosa_hcp.cloudwatch[0].sts.oidc_endpoint_url, "https://", "") : ""
}

resource "aws_iam_policy" "cloudwatch_logging" {
  count = var.deploy_cloudwatch_logging ? 1 : 0
  name  = "${local.cluster_name}-cloudwatch-logging"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:DescribeLogGroups",
          "logs:DescribeLogStreams",
          "logs:PutLogEvents",
          "logs:PutRetentionPolicy"
        ]
        Resource = "arn:aws:logs:*:${data.aws_caller_identity.current.account_id}:*"
      }
    ]
  })
}

resource "aws_iam_role" "cloudwatch_logging" {
  count = var.deploy_cloudwatch_logging ? 1 : 0
  name  = "${local.cluster_name}-cloudwatch-logging"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Federated = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:oidc-provider/${local.cloudwatch_oidc_url}"
      }
      Action = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "${local.cloudwatch_oidc_url}:sub" = "system:serviceaccount:${var.cloudwatch_namespace}:${var.cloudwatch_service_account}"
          "${local.cloudwatch_oidc_url}:aud" = ["openshift", "sts.amazonaws.com"]
        }
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "cloudwatch_logging" {
  count      = var.deploy_cloudwatch_logging ? 1 : 0
  role       = aws_iam_role.cloudwatch_logging[0].name
  policy_arn = aws_iam_policy.cloudwatch_logging[0].arn
}

output "cloudwatch_iam_role_arn" {
  value       = var.deploy_cloudwatch_logging ? aws_iam_role.cloudwatch_logging[0].arn : ""
  description = "IAM role ARN for the CloudWatch log collector."
}
