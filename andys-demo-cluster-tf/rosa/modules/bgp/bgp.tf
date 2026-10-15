resource "aws_vpc_route_server" "this" {
  amazon_side_asn           = var.route_server_asn
  persist_routes            = "disable"
  sns_notifications_enabled = false

  tags = {
    Name = "${var.cluster_name}-route-server"
  }
}

resource "aws_vpc_route_server_vpc_association" "this" {
  route_server_id = aws_vpc_route_server.this.route_server_id
  vpc_id          = var.vpc_id
}

resource "aws_vpc_route_server_propagation" "private" {
  count           = length(var.private_route_table_ids)
  route_server_id = aws_vpc_route_server.this.route_server_id
  route_table_id  = var.private_route_table_ids[count.index]

  # EnableRouteServerPropagation fails with InvalidRouteServerId.NotAssociated
  # unless the VPC association already exists. Nothing else in this resource
  # references the association, so the edge has to be declared.
  depends_on = [aws_vpc_route_server_vpc_association.this]
}

resource "aws_vpc_route_server_propagation" "public" {
  count           = length(var.public_route_table_ids)
  route_server_id = aws_vpc_route_server.this.route_server_id
  route_table_id  = var.public_route_table_ids[count.index]

  depends_on = [aws_vpc_route_server_vpc_association.this]
}

resource "aws_vpc_route_server_endpoint" "this" {
  count           = length(var.private_subnets)
  route_server_id = aws_vpc_route_server.this.route_server_id
  subnet_id       = var.private_subnets[count.index]
}

resource "aws_security_group" "rfc1918" {
  name        = "${var.cluster_name}-bgp-rfc1918"
  description = "Allow all RFC1918 traffic for BGP routing"
  vpc_id      = var.vpc_id

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
    Name = "${var.cluster_name}-bgp-rfc1918"
  }
}

resource "aws_security_group" "allow_all" {
  name        = "${var.cluster_name}-bgp-allow-all"
  description = "Allow all traffic to enable IGW traffic for pod networks"
  vpc_id      = var.vpc_id

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
    Name = "${var.cluster_name}-bgp-allow-all"
  }
}

output "route_server_id" {
  value       = aws_vpc_route_server.this.route_server_id
  description = "VPC Route Server ID."
}

output "route_server_asn" {
  value       = var.route_server_asn
  description = "VPC Route Server ASN."
}

output "endpoint_ips" {
  value       = [for ep in aws_vpc_route_server_endpoint.this : ep.eni_address]
  description = "VPC Route Server endpoint IP addresses."
}

output "security_group_ids" {
  value       = [aws_security_group.rfc1918.id, aws_security_group.allow_all.id]
  description = "Security groups the BGP router machine pool needs attached."
}
