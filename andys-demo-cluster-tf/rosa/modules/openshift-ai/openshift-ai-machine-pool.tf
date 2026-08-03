module "rosa-ai-machine-pool-gpu-pool" {
  source  = "terraform-redhat/rosa-hcp/rhcs//modules/machine-pool"
  version = "1.6.3"

  cluster_id        = var.cluster_id
  name              = "${var.cluster_name}-gpu"
  openshift_version = var.openshift_version

  aws_node_pool = {
    instance_type = "g7e.2xlarge"
    tags          = var.tags
  }

  subnet_id = var.subnet_id
  autoscaling = {
    enabled      = false
    min_replicas = null
    max_replicas = null
  }

  taints = [{
    key           = "nvidia.com/gpu",
    value         = "present",
    schedule_type = "NoSchedule"
  }]
  replicas = 1
}

module "rosa-openshift-ai-machine-pool" {
  source  = "terraform-redhat/rosa-hcp/rhcs//modules/machine-pool"
  version = "1.6.3"

  cluster_id        = var.cluster_id
  name              = "${var.cluster_name}-ai"
  openshift_version = var.openshift_version

  aws_node_pool = {
    instance_type = "m5.4xlarge"
    tags          = var.tags
  }

  subnet_id = var.subnet_id
  autoscaling = {
    enabled      = false
    min_replicas = null
    max_replicas = null
  }
  replicas = 2
}

data "aws_caller_identity" "current" {}
data "rhcs_cluster_rosa_hcp" "cluster" {
  id = var.cluster_id
}

locals {
  oidc_id = replace(data.rhcs_cluster_rosa_hcp.cluster.sts.oidc_endpoint_url, "https://", "")
}

data "aws_iam_policy_document" "rhoai-oidc" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    effect  = "Allow"

    condition {
      test     = "StringEquals"
      variable = "${local.oidc_id}:sub"
      values   = ["system:serviceaccount:andys-ai:default"]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.oidc_id}:aud"
      values   = ["sts.amazonaws.com"]
    }

    principals {
      identifiers = [
        "arn:aws:iam::${data.aws_caller_identity.current.account_id}:oidc-provider/${local.oidc_id}"
      ]
      type = "Federated"
    }
  }
}

resource "aws_s3_bucket" "rhoai-data" {
  bucket = "${var.cluster_name}-rhoai-storage"
}

resource "aws_s3_bucket_policy" "rhoai-grant-access" {
  bucket = aws_s3_bucket.rhoai-data.id
  policy = jsonencode({
    Version : "2012-10-17",
    Statement : [
      {
        Sid : "Statement1",
        Effect : "Allow",
        Principal : {
          AWS : aws_iam_role.rhoai.arn
        },
        Action : [
          "s3:PutObject",
          "s3:GetObject",
          "s3:DeleteObject",
          "s3:ListBucket"
        ],
        Resource : [
          aws_s3_bucket.rhoai-data.arn,
          "${aws_s3_bucket.rhoai-data.arn}/*"
        ]
      }
    ]
  })
}

resource "aws_iam_role" "rhoai" {
  name               = "${var.cluster_name}-rhoai-access-role"
  assume_role_policy = data.aws_iam_policy_document.rhoai-oidc.json

  inline_policy {}
}

resource "aws_iam_policy" "rhoai" {
  name        = "${var.cluster_name}-rhoai-access-policy"
  path        = "/"
  description = "Allows Red Hat OpenShift AI to access bucket"

  policy = jsonencode({
    Version : "2012-10-17",
    Statement : [
      {
        Effect : "Allow",
        Action : [
          "s3:ListBucket",
          "s3:PutObject",
          "s3:GetObject",
          "s3:DeleteObject"
        ],
        Resource : [
          aws_s3_bucket.rhoai-data.arn,
          "${aws_s3_bucket.rhoai-data.arn}/*"
        ]
      },
      {
        Effect : "Allow",
        Action : [
          "s3:ListAllMyBuckets"
        ],
        Resource : "*"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "rhoai-attach" {
  role       = aws_iam_role.rhoai.name
  policy_arn = aws_iam_policy.rhoai.arn
}

# Currently OpenShift AI cannot use the STS/IRSA setup above, it's there for when the RFE is completed.
# For now we need to generate an access/secret key
resource "aws_iam_user" "rhoai-access" {
  name = "${var.cluster_name}-rhoai-access-user"
}

resource "aws_iam_user_policy_attachment" "rhoai-user-attach" {
  user       = aws_iam_user.rhoai-access.name
  policy_arn = aws_iam_policy.rhoai.arn
}

resource "aws_iam_access_key" "rhoai-access" {
  user = aws_iam_user.rhoai-access.name
}

output "aws_iam_access_key" {
  value = aws_iam_access_key.rhoai-access.id
}

output "aws_iam_secret_key" {
  value = aws_iam_access_key.rhoai-access.secret
}
