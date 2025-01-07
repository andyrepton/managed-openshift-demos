data "aws_lb" "rosa-1" {
  provider = aws.west
  arn = var.rosa_1_nlb
}

data "aws_lb" "rosa-2" {
  provider = aws.central
  arn = var.rosa_2_nlb
}

resource "aws_route53_record" "rosa-1" {
  zone_id = var.route53_zone
  name    = "*.poc-andyr.labs.aws.andyrepton.com"
  type    = "A"

  weighted_routing_policy {
    weight = var.rosa_1_weight
  }

  set_identifier = "rosa-1"

  alias {
    name                   = data.aws_lb.rosa-1.dns_name
    zone_id                = data.aws_lb.rosa-1.zone_id
    evaluate_target_health = true
  }
}

resource "aws_route53_record" "rosa-2" {
  zone_id = var.route53_zone
  name    = "*.poc-andyr.labs.aws.andyrepton.com"
  type    = "A"

  weighted_routing_policy {
    weight = var.rosa_2_weight
  }

  set_identifier = "rosa-2"

  alias {
    name                   = data.aws_lb.rosa-2.dns_name
    zone_id                = data.aws_lb.rosa-2.zone_id
    evaluate_target_health = true
  }
}
