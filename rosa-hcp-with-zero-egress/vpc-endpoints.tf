data "aws_region" "current" {}

resource "aws_security_group" "authorize_inbound_vpc_traffic" {
  ingress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = var.private_subnet_cidrs
  }
  vpc_id = module.vpc.vpc_id

  egress {
    from_port        = 0
    to_port          = 0
    protocol         = "-1"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }
}

# https://docs.aws.amazon.com/AmazonECR/latest/userguide/vpc-endpoints.html
resource "aws_vpc_endpoint" "sts" {
  service_name      = "com.amazonaws.${data.aws_region.current.name}.sts"
  vpc_id            = module.vpc.vpc_id
  vpc_endpoint_type = "Interface"

  private_dns_enabled = true
  subnet_ids          = module.vpc.private_subnets
  security_group_ids  = [aws_security_group.authorize_inbound_vpc_traffic.id]

  tags = {
    Terraform    = "true"
    service      = "ROSA"
    cluster_name = local.cluster_name
  }
}

resource "aws_vpc_endpoint" "ecr_api" {
  service_name      = "com.amazonaws.${data.aws_region.current.name}.ecr.api"
  vpc_id            = module.vpc.vpc_id
  vpc_endpoint_type = "Interface"

  private_dns_enabled = true
  subnet_ids          = module.vpc.private_subnets
  security_group_ids  = [aws_security_group.authorize_inbound_vpc_traffic.id]

  tags = {
    Terraform    = "true"
    service      = "ROSA"
    cluster_name = local.cluster_name
  }
}

# https://docs.aws.amazon.com/AmazonECR/latest/userguide/vpc-endpoints.html
resource "aws_vpc_endpoint" "ecr_dkr" {
  service_name      = "com.amazonaws.${data.aws_region.current.name}.ecr.dkr"
  vpc_id            = module.vpc.vpc_id
  vpc_endpoint_type = "Interface"

  private_dns_enabled = true
  subnet_ids          = module.vpc.private_subnets
  security_group_ids  = [aws_security_group.authorize_inbound_vpc_traffic.id]

  tags = {
    Terraform    = "true"
    service      = "ROSA"
    cluster_name = local.cluster_name
  }
}

# https://docs.aws.amazon.com/vpc/latest/privatelink/vpc-endpoints-s3.html
resource "aws_vpc_endpoint" "s3" {
  service_name      = "com.amazonaws.${data.aws_region.current.name}.s3"
  vpc_id            = module.vpc.vpc_id
  vpc_endpoint_type = "Gateway"

  # Associate with route tables instead of subnets
  route_table_ids = module.vpc.private_route_table_ids

  tags = {
    Terraform    = "true"
    service      = "ROSA"
    cluster_name = local.cluster_name
  }
}
