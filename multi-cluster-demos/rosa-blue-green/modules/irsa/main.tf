data "aws_caller_identity" "current" {}

data "rhcs_cluster_rosa_hcp" "cluster" {
  id = var.cluster_id
}

locals {
  oidc_id = replace(
    data.rhcs_cluster_rosa_hcp.cluster.sts.oidc_endpoint_url,
    "https://",
    ""
  )
}

data "aws_iam_policy_document" "irsa_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    effect  = "Allow"

    condition {
      test     = "StringEquals"
      variable = "${local.oidc_id}:sub"
      values   = ["system:serviceaccount:${var.namespace}:${var.service_account}"]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.oidc_id}:aud"
      values   = ["sts.amazonaws.com"]
    }

    principals {
      type = "Federated"
      identifiers = [
        "arn:aws:iam::${data.aws_caller_identity.current.account_id}:oidc-provider/${local.oidc_id}"
      ]
    }
  }
}

resource "aws_iam_role" "irsa" {
  name               = "${var.role_name_prefix}-${var.role_name}"
  assume_role_policy = data.aws_iam_policy_document.irsa_trust.json
  tags               = var.tags
}

resource "aws_iam_role_policy_attachment" "irsa" {
  for_each = toset(var.policy_arns)

  role       = aws_iam_role.irsa.name
  policy_arn = each.value
}
