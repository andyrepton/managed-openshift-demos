data "rhcs_cluster_rosa_hcp" "cluster" {
  id = module.rosa.cluster_id
}

locals {
  oidc_id = replace(data.rhcs_cluster_rosa_hcp.cluster.sts.oidc_endpoint_url, "https://", "")
}

data "aws_iam_policy_document" "autonode-oidc" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    effect  = "Allow"

    condition {
      test     = "StringEquals"
      variable = "${local.oidc_id}:sub"
      values   = ["system:serviceaccount:kube-system:karpenter"]
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

resource "aws_iam_role" "autonode" {
  name               = "${var.cluster_name}-autonode-operator-role"
  assume_role_policy = data.aws_iam_policy_document.autonode-oidc.json

  inline_policy {}
}

resource "aws_iam_policy" "autonode" {
  name        = "${var.cluster_name}-autonode-access-policy"
  path        = "/"
  description = "Allows Autonode to access create nodes"

  policy = jsonencode({
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "AllowScopedEC2InstanceAccessActions",
            "Effect": "Allow",
            "Resource": [
                "arn:*:ec2:*::image/*",
                "arn:*:ec2:*::snapshot/*",
                "arn:*:ec2:*:*:security-group/*",
                "arn:*:ec2:*:*:subnet/*"
            ],
            "Action": [
                "ec2:RunInstances",
                "ec2:CreateFleet"
            ]
        },
        {
            "Sid": "AllowScopedEC2LaunchTemplateAccessActions",
            "Effect": "Allow",
            "Resource": "arn:*:ec2:*:*:launch-template/*",
            "Action": [
                "ec2:RunInstances",
                "ec2:CreateFleet"
            ]
        },
        {
            "Sid": "AllowScopedEC2InstanceActionsWithTags",
            "Effect": "Allow",
            "Resource": [
                "arn:*:ec2:*:*:fleet/*",
                "arn:*:ec2:*:*:instance/*",
                "arn:*:ec2:*:*:volume/*",
                "arn:*:ec2:*:*:network-interface/*",
                "arn:*:ec2:*:*:launch-template/*",
                "arn:*:ec2:*:*:spot-instances-request/*"
            ],
            "Action": [
                "ec2:RunInstances",
                "ec2:CreateFleet",
                "ec2:CreateLaunchTemplate"
            ],
            "Condition": {
                "StringLike": {
                    "aws:RequestTag/karpenter.sh/nodepool": "*"
                }
            }
        },
        {
            "Sid": "AllowScopedResourceCreationTagging",
            "Effect": "Allow",
            "Resource": [
                "arn:*:ec2:*:*:fleet/*",
                "arn:*:ec2:*:*:instance/*",
                "arn:*:ec2:*:*:volume/*",
                "arn:*:ec2:*:*:network-interface/*",
                "arn:*:ec2:*:*:launch-template/*",
                "arn:*:ec2:*:*:spot-instances-request/*"
            ],
            "Action": "ec2:CreateTags",
            "Condition": {
                "StringEquals": {
                    "ec2:CreateAction": [
                        "RunInstances",
                        "CreateFleet",
                        "CreateLaunchTemplate"
                    ]
                },
                "StringLike": {
                    "aws:RequestTag/karpenter.sh/nodepool": "*"
                }
            }
        },
        {
            "Sid": "AllowScopedResourceTagging",
            "Effect": "Allow",
            "Resource": "arn:*:ec2:*:*:instance/*",
            "Action": "ec2:CreateTags",
            "Condition": {
                "StringLike": {
                    "aws:ResourceTag/karpenter.sh/nodepool": "*"
                }
            }
        },
        {
            "Sid": "AllowScopedDeletion",
            "Effect": "Allow",
            "Resource": [
                "arn:*:ec2:*:*:instance/*",
                "arn:*:ec2:*:*:launch-template/*"
            ],
            "Action": [
                "ec2:TerminateInstances",
                "ec2:DeleteLaunchTemplate"
            ],
            "Condition": {
                "StringLike": {
                    "aws:ResourceTag/karpenter.sh/nodepool": "*"
                }
            }
        },
        {
            "Sid": "AllowRegionalReadActions",
            "Effect": "Allow",
            "Resource": "*",
            "Action": [
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
            "Sid": "AllowSSMReadActions",
            "Effect": "Allow",
            "Resource": "arn:*:ssm:*::parameter/aws/service/*",
            "Action": "ssm:GetParameter"
        },
        {
            "Sid": "AllowPricingReadActions",
            "Effect": "Allow",
            "Resource": "*",
            "Action": "pricing:GetProducts"
        },
        {
            "Sid": "AllowInterruptionQueueActions",
            "Effect": "Allow",
            "Resource": "*",
            "Action": [
                "sqs:DeleteMessage",
                "sqs:GetQueueUrl",
                "sqs:ReceiveMessage"
            ]
        },
        {
            "Sid": "AllowPassingInstanceRole",
            "Effect": "Allow",
            "Resource": "arn:*:iam::*:role/*",
            "Action": "iam:PassRole",
            "Condition": {
                "StringEquals": {
                    "iam:PassedToService": [
                        "ec2.amazonaws.com",
                        "ec2.amazonaws.com.cn"
                    ]
                }
            }
        },
        {
            "Sid": "AllowScopedInstanceProfileCreationActions",
            "Effect": "Allow",
            "Resource": "arn:*:iam::*:instance-profile/*",
            "Action": [
                "iam:CreateInstanceProfile"
            ],
            "Condition": {
                "StringLike": {
                    "aws:RequestTag/karpenter.k8s.aws/ec2nodeclass": "*"
                }
            }
        },
        {
            "Sid": "AllowScopedInstanceProfileTagActions",
            "Effect": "Allow",
            "Resource": "arn:*:iam::*:instance-profile/*",
            "Action": [
                "iam:TagInstanceProfile"
            ],
            "Condition": {
                "StringLike": {
                    "aws:ResourceTag/karpenter.k8s.aws/ec2nodeclass": "*",
                    "aws:RequestTag/karpenter.k8s.aws/ec2nodeclass": "*"
                }
            }
        },
        {
            "Sid": "AllowScopedInstanceProfileActions",
            "Effect": "Allow",
            "Resource": "arn:*:iam::*:instance-profile/*",
            "Action": [
                "iam:AddRoleToInstanceProfile",
                "iam:RemoveRoleFromInstanceProfile",
                "iam:DeleteInstanceProfile"
            ],
            "Condition": {
                "StringLike": {
                    "aws:ResourceTag/karpenter.k8s.aws/ec2nodeclass": "*"
                }
            }
        },
        {
            "Sid": "AllowInstanceProfileReadActions",
            "Effect": "Allow",
            "Resource": "arn:*:iam::*:instance-profile/*",
            "Action": "iam:GetInstanceProfile"
        }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "autonode-attach" {
  role       = aws_iam_role.autonode.name
  policy_arn = aws_iam_policy.autonode.arn
}

output "autonode_role_arn" {
  value = aws_iam_role.autonode.arn 
}
