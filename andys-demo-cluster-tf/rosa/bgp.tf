resource "aws_vpc_route_server" "bgp" {
  count                     = var.deploy_bgp ? 1 : 0
  amazon_side_asn            = var.bgp_route_server_asn
  persist_routes             = "disable"
  sns_notifications_enabled  = false

  tags = {
    Name = "${local.cluster_name}-route-server"
  }
}

resource "aws_vpc_route_server_vpc_association" "bgp" {
  count           = var.deploy_bgp && var.create_vpc ? 1 : 0
  route_server_id = aws_vpc_route_server.bgp[0].route_server_id
  vpc_id          = module.vpc[0].vpc_id
}

resource "aws_vpc_route_server_propagation" "private" {
  count           = var.deploy_bgp && var.create_vpc ? length(module.vpc[0].private_route_table_ids) : 0
  route_server_id = aws_vpc_route_server.bgp[0].route_server_id
  route_table_id  = module.vpc[0].private_route_table_ids[count.index]
}

resource "aws_vpc_route_server_propagation" "public" {
  count           = var.deploy_bgp && var.create_vpc ? length(module.vpc[0].public_route_table_ids) : 0
  route_server_id = aws_vpc_route_server.bgp[0].route_server_id
  route_table_id  = module.vpc[0].public_route_table_ids[count.index]
}

resource "aws_vpc_route_server_endpoint" "bgp" {
  count           = var.deploy_bgp && var.create_vpc ? length(module.vpc[0].private_subnets) : 0
  route_server_id = aws_vpc_route_server.bgp[0].route_server_id
  subnet_id       = module.vpc[0].private_subnets[count.index]
}

resource "aws_security_group" "bgp_rfc1918" {
  count       = var.deploy_bgp && var.create_vpc ? 1 : 0
  name        = "${local.cluster_name}-bgp-rfc1918"
  description = "Allow all RFC1918 traffic for BGP routing"
  vpc_id      = module.vpc[0].vpc_id

  ingress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${local.cluster_name}-bgp-rfc1918"
  }
}

resource "aws_security_group" "bgp_allow_all" {
  count       = var.deploy_bgp && var.create_vpc ? 1 : 0
  name        = "${local.cluster_name}-bgp-allow-all"
  description = "Allow all traffic to enable IGW traffic for pod networks"
  vpc_id      = module.vpc[0].vpc_id

  ingress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${local.cluster_name}-bgp-allow-all"
  }
}

output "bgp_route_server_id" {
  value       = var.deploy_bgp ? aws_vpc_route_server.bgp[0].route_server_id : ""
  description = "VPC Route Server ID."
}

output "bgp_route_server_asn" {
  value       = var.deploy_bgp ? var.bgp_route_server_asn : ""
  description = "VPC Route Server ASN."
}

output "bgp_endpoint_ips" {
  value       = var.deploy_bgp && var.create_vpc ? [for ep in aws_vpc_route_server_endpoint.bgp : ep.eni_address] : []
  description = "VPC Route Server endpoint IP addresses."
}
