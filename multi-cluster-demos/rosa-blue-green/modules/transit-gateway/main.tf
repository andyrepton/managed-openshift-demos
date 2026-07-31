module "transit_gateway" {
  source  = "terraform-aws-modules/transit-gateway/aws"
  version = "3.2.0"

  name        = var.name
  description = "Transit gateway connecting blue-green ROSA HCP VPCs"

  enable_default_route_table_association = true
  enable_default_route_table_propagation = true
  enable_dns_support                     = true
  enable_auto_accept_shared_attachments  = true

  vpc_attachments = {
    for k, v in var.vpc_attachments : k => {
      vpc_id      = v.vpc_id
      subnet_ids  = v.subnet_ids
      dns_support = true

      transit_gateway_default_route_table_association = true
      transit_gateway_default_route_table_propagation = true
    }
  }

  tags = var.tags
}

locals {
  cross_routes = flatten([
    for src_key, src in var.vpc_attachments : [
      for dst_key, dst in var.vpc_attachments : [
        for rt_id in src.private_route_table_ids : {
          key              = "${src_key}-to-${dst_key}-${rt_id}"
          route_table_id   = rt_id
          destination_cidr = dst.vpc_cidr
        }
      ] if src_key != dst_key
    ]
  ])
}

resource "aws_route" "tgw" {
  for_each = { for route in local.cross_routes : route.key => route }

  route_table_id         = each.value.route_table_id
  destination_cidr_block = each.value.destination_cidr
  transit_gateway_id     = module.transit_gateway.ec2_transit_gateway_id

  depends_on = [module.transit_gateway]
}
