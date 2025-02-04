module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = ">= 5.8.1"

  name = "${local.cluster_name}-vpc"
  cidr = var.vpc_cidr_block

  azs             = local.region_azs
  private_subnets = var.multi_az ? var.private_subnet_cidrs : [var.private_subnet_cidrs[0]]
  public_subnets  = var.multi_az ? var.public_subnet_cidrs : [var.public_subnet_cidrs[0]]

  enable_nat_gateway   = var.private_cluster ? false : true
  enable_dns_hostnames = true
  enable_dns_support   = true
  manage_default_security_group = false

  tags = var.additional_tags
}
