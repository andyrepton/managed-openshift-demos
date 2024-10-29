
# Create custom entries for Console, OAuth and downloads

# Create the zone
resource "aws_route53_zone" "custom_console_route" {
  name = "${local.cluster_name}.mobb.ninja"
}

# Get the load balancer of the Ingress Controller
data "aws_lb" "ingress-lb" {
  tags = {
    "kubernetes.io/cluster/${data.rhcs_cluster_rosa_classic.cluster.infra_id}" = "owned"
    #"kubernetes.io/service-name" = "openshift-ingress/router-default"
  }
}

# Create console route in the new hosted zone
resource "aws_route53_record" "console" {
  zone_id = aws_route53_zone.custom_console_route.zone_id
  name    = "console"
  type    = "A"

  alias {
    name = data.aws_lb.ingress-lb.dns_name
    zone_id = data.aws_lb_hosted_zone_id.main.id
    evaluate_target_health = true
  }
}
