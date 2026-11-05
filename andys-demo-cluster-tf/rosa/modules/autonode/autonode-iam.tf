# IAM role for ROSA AutoNode (the Karpenter-based autoscaler,
# demo-autonode-on-rosa), assumed by the karpenter ServiceAccount in the hosted
# control plane through the cluster's OIDC provider, plus the
# karpenter.sh/discovery tags AutoNode uses to find the subnets and security
# group for the nodes it launches.

data "aws_caller_identity" "current" {}

data "rhcs_cluster_rosa_hcp" "cluster" {
  id = var.cluster_id
}

locals {
  oidc_url = replace(data.rhcs_cluster_rosa_hcp.cluster.sts.oidc_endpoint_url, "https://", "")
}

resource "aws_iam_role" "this" {
  name = "${var.cluster_name}-autonode-operator-role"

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
          "${local.oidc_url}:sub" = "system:serviceaccount:kube-system:karpenter"
          "${local.oidc_url}:aud" = ["openshift", "sts.amazonaws.com"]
        }
      }
    }]
  })
}

resource "aws_iam_policy" "this" {
  name        = "${var.cluster_name}-autonode-access-policy"
  path        = "/"
  description = "Allows AutoNode to create and remove nodes"

  policy = jsonencode({
    "Version" : "2012-10-17",
    "Statement" : [
      {
        "Sid" : "AllowScopedEC2InstanceAccessActions",
        "Effect" : "Allow",
        "Resource" : [
          "arn:*:ec2:*::image/*",
          "arn:*:ec2:*::snapshot/*",
          "arn:*:ec2:*:*:security-group/*",
          "arn:*:ec2:*:*:subnet/*"
        ],
        "Action" : [
          "ec2:RunInstances",
          "ec2:CreateFleet"
        ]
      },
      {
        "Sid" : "AllowScopedEC2LaunchTemplateAccessActions",
        "Effect" : "Allow",
        "Resource" : "arn:*:ec2:*:*:launch-template/*",
        "Action" : [
          "ec2:RunInstances",
          "ec2:CreateFleet"
        ]
      },
      {
        "Sid" : "AllowScopedEC2InstanceActionsWithTags",
        "Effect" : "Allow",
        "Resource" : [
          "arn:*:ec2:*:*:fleet/*",
          "arn:*:ec2:*:*:instance/*",
          "arn:*:ec2:*:*:volume/*",
          "arn:*:ec2:*:*:network-interface/*",
          "arn:*:ec2:*:*:launch-template/*",
          "arn:*:ec2:*:*:spot-instances-request/*"
        ],
        "Action" : [
          "ec2:RunInstances",
          "ec2:CreateFleet",
          "ec2:CreateLaunchTemplate"
        ],
        "Condition" : {
          "StringLike" : {
            "aws:RequestTag/karpenter.sh/nodepool" : "*"
          }
        }
      },
      {
        "Sid" : "AllowScopedResourceCreationTagging",
        "Effect" : "Allow",
        "Resource" : [
          "arn:*:ec2:*:*:fleet/*",
          "arn:*:ec2:*:*:instance/*",
          "arn:*:ec2:*:*:volume/*",
          "arn:*:ec2:*:*:network-interface/*",
          "arn:*:ec2:*:*:launch-template/*",
          "arn:*:ec2:*:*:spot-instances-request/*"
        ],
        "Action" : "ec2:CreateTags",
        "Condition" : {
          "StringEquals" : {
            "ec2:CreateAction" : [
              "RunInstances",
              "CreateFleet",
              "CreateLaunchTemplate"
            ]
          },
          "StringLike" : {
            "aws:RequestTag/karpenter.sh/nodepool" : "*"
          }
        }
      },
      {
        "Sid" : "AllowScopedResourceTagging",
        "Effect" : "Allow",
        "Resource" : "arn:*:ec2:*:*:instance/*",
        "Action" : "ec2:CreateTags",
        "Condition" : {
          "StringLike" : {
            "aws:ResourceTag/karpenter.sh/nodepool" : "*"
          }
        }
      },
      {
        "Sid" : "AllowScopedDeletion",
        "Effect" : "Allow",
        "Resource" : [
          "arn:*:ec2:*:*:instance/*",
          "arn:*:ec2:*:*:launch-template/*"
        ],
        "Action" : [
          "ec2:TerminateInstances",
          "ec2:DeleteLaunchTemplate"
        ],
        "Condition" : {
          "StringLike" : {
            "aws:ResourceTag/karpenter.sh/nodepool" : "*"
          }
        }
      },
      {
        "Sid" : "AllowRegionalReadActions",
        "Effect" : "Allow",
        "Resource" : "*",
        "Action" : [
          "ec2:DescribeImages",
          "ec2:DescribeInstances",
          "ec2:DescribeInstanceTypeOfferings",
          "ec2:DescribeInstanceTypes",
          "ec2:DescribeLaunchTemplates",
          "ec2:DescribeSecurityGroups",
          "ec2:DescribeSpotPriceHistory",
          "ec2:DescribeSubnets"
        ]
      },
      {
        "Sid" : "AllowSSMReadActions",
        "Effect" : "Allow",
        "Resource" : "arn:*:ssm:*::parameter/aws/service/*",
        "Action" : "ssm:GetParameter"
      },
      {
        "Sid" : "AllowPricingReadActions",
        "Effect" : "Allow",
        "Resource" : "*",
        "Action" : "pricing:GetProducts"
      },
      {
        "Sid" : "AllowInterruptionQueueActions",
        "Effect" : "Allow",
        "Resource" : "*",
        "Action" : [
          "sqs:DeleteMessage",
          "sqs:GetQueueUrl",
          "sqs:ReceiveMessage"
        ]
      },
      {
        "Sid" : "AllowPassingInstanceRole",
        "Effect" : "Allow",
        "Resource" : "arn:*:iam::*:role/*",
        "Action" : "iam:PassRole",
        "Condition" : {
          "StringEquals" : {
            "iam:PassedToService" : [
              "ec2.amazonaws.com",
              "ec2.amazonaws.com.cn"
            ]
          }
        }
      },
      {
        "Sid" : "AllowScopedInstanceProfileCreationActions",
        "Effect" : "Allow",
        "Resource" : "arn:*:iam::*:instance-profile/*",
        "Action" : [
          "iam:CreateInstanceProfile"
        ],
        "Condition" : {
          "StringLike" : {
            "aws:RequestTag/karpenter.k8s.aws/ec2nodeclass" : "*"
          }
        }
      },
      {
        "Sid" : "AllowScopedInstanceProfileTagActions",
        "Effect" : "Allow",
        "Resource" : "arn:*:iam::*:instance-profile/*",
        "Action" : [
          "iam:TagInstanceProfile"
        ],
        "Condition" : {
          "StringLike" : {
            "aws:ResourceTag/karpenter.k8s.aws/ec2nodeclass" : "*",
            "aws:RequestTag/karpenter.k8s.aws/ec2nodeclass" : "*"
          }
        }
      },
      {
        "Sid" : "AllowScopedInstanceProfileActions",
        "Effect" : "Allow",
        "Resource" : "arn:*:iam::*:instance-profile/*",
        "Action" : [
          "iam:AddRoleToInstanceProfile",
          "iam:RemoveRoleFromInstanceProfile",
          "iam:DeleteInstanceProfile"
        ],
        "Condition" : {
          "StringLike" : {
            "aws:ResourceTag/karpenter.k8s.aws/ec2nodeclass" : "*"
          }
        }
      },
      {
        "Sid" : "AllowInstanceProfileReadActions",
        "Effect" : "Allow",
        "Resource" : "arn:*:iam::*:instance-profile/*",
        "Action" : "iam:GetInstanceProfile"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "this" {
  role       = aws_iam_role.this.name
  policy_arn = aws_iam_policy.this.arn
}

# The cluster's default security group, created by ROSA as <cluster-id>-default-sg.
data "aws_security_group" "cluster_default" {
  filter {
    name   = "tag:Name"
    values = ["${var.cluster_id}-default-sg"]
  }
}

resource "aws_ec2_tag" "subnet_discovery" {
  for_each    = toset(var.private_subnet_ids)
  resource_id = each.value
  key         = "karpenter.sh/discovery"
  value       = var.cluster_id
}

resource "aws_ec2_tag" "sg_discovery" {
  resource_id = data.aws_security_group.cluster_default.id
  key         = "karpenter.sh/discovery"
  value       = var.cluster_id
}

output "iam_role_arn" {
  value       = aws_iam_role.this.arn
  description = "IAM role ARN for AutoNode."
}
