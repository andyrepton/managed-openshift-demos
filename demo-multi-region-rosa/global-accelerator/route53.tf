resource "aws_route53_record" "accelerator" {
  zone_id = var.route53_zone
  name    = "*.accelerator.poc-andyr.labs.aws.andyrepton.com"
  type    = "A"

  alias {
    name                   = aws_globalaccelerator_accelerator.rosa-multi-region.dns_name
    zone_id                = aws_globalaccelerator_accelerator.rosa-multi-region.hosted_zone_id
    evaluate_target_health = true
  }
}
