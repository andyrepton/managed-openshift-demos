# Make a Private Hosted Zone and link to cluster

resource "aws_route53_zone" "private" {
  name = var.custom_domain

  vpc {
    vpc_id = module.rosa_cluster.vpc_id
  }
}

# Get NLBs that match tags
data "aws_lbs" "nlbs" {
  tags = {
    "cluster_name" = local.cluster_name
  }
  depends_on = [ module.rosa_cluster ]
}

# This is needed because Terraform cannot currently select something based on a tag where the value has a / in it.

locals {
  nlb = toset([ for x in data.aws_lbs.nlbs.arns : x if ! can(regex(local.cluster_name, x)) ])
}

data "aws_lb" "nlb" {
  arn  = one(local.nlb)
}

resource "aws_route53_record" "private_hosted_zone_record" {
  zone_id = aws_route53_zone.private.zone_id
  name    = "*"
  type    = "A"

  alias {
    name                   = data.aws_lb.nlb.dns_name
    zone_id                = data.aws_lb.nlb.zone_id
    evaluate_target_health = true
  }
}
