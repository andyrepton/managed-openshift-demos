data "aws_caller_identity" "current" {}

data "rhcs_cluster_rosa_hcp" "cluster" {
  id = var.cluster_id
}

locals {
  oidc_url = replace(data.rhcs_cluster_rosa_hcp.cluster.sts.oidc_endpoint_url, "https://", "")
}

resource "aws_iam_policy" "this" {
  name = "${var.cluster_name}-bgp-cloud-connector"

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

resource "aws_iam_role" "this" {
  name = "${var.cluster_name}-bgp-cloud-connector"

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
          "${local.oidc_url}:sub" = "system:serviceaccount:${var.operator_namespace}:${var.operator_service_account}"
          # Both audiences: the CCO path projects a token with "openshift",
          # the IRSA webhook injects one with "sts.amazonaws.com". Listing
          # both lets the one role serve either. Do not narrow to one value.
          "${local.oidc_url}:aud" = ["openshift", "sts.amazonaws.com"]
        }
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "this" {
  role       = aws_iam_role.this.name
  policy_arn = aws_iam_policy.this.arn
}

output "iam_role_arn" {
  value       = aws_iam_role.this.arn
  description = "IAM role ARN for the bgp-cloud-connector operator."
}
