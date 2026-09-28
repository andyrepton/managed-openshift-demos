data "rhcs_cluster_rosa_hcp" "bgp" {
  count = var.deploy_bgp ? 1 : 0
  id    = module.rosa-hcp.cluster_id
}

data "aws_caller_identity" "current" {}

locals {
  bgp_oidc_url = var.deploy_bgp ? replace(data.rhcs_cluster_rosa_hcp.bgp[0].sts.oidc_endpoint_url, "https://", "") : ""
}

resource "aws_iam_policy" "bgp_cloud_connector" {
  count = var.deploy_bgp ? 1 : 0
  name  = "${local.cluster_name}-bgp-cloud-connector"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "sts:GetCallerIdentity",
          "ec2:DescribeRouteServers",
          "ec2:DescribeRouteServerEndpoints",
          "ec2:DescribeRouteServerPeers",
          "ec2:DescribeSubnets",
          "ec2:DescribeInstances",
          "ec2:CreateRouteServerPeer",
          "ec2:DeleteRouteServerPeer",
          "ec2:CreateTags",
          "ec2:ModifyNetworkInterfaceAttribute"
        ]
        Resource = "*"
      }
    ]
  })
}

resource "aws_iam_role" "bgp_cloud_connector" {
  count = var.deploy_bgp ? 1 : 0
  name  = "${local.cluster_name}-bgp-cloud-connector"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = {
        Federated = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:oidc-provider/${local.bgp_oidc_url}"
      }
      Action = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "${local.bgp_oidc_url}:sub" = "system:serviceaccount:${var.bgp_operator_namespace}:${var.bgp_operator_service_account}"
          "${local.bgp_oidc_url}:aud" = ["openshift", "sts.amazonaws.com"]
        }
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "bgp_cloud_connector" {
  count      = var.deploy_bgp ? 1 : 0
  role       = aws_iam_role.bgp_cloud_connector[0].name
  policy_arn = aws_iam_policy.bgp_cloud_connector[0].arn
}

output "bgp_iam_role_arn" {
  value       = var.deploy_bgp ? aws_iam_role.bgp_cloud_connector[0].arn : ""
  description = "IAM role ARN for the bgp-cloud-connector operator."
}
