locals {
  # Load balancer subnets (public): 3x /28 = 48 addresses (19%)
  public_subnets = [
    cidrsubnet(var.vpc_cidr, 4, 0),
    cidrsubnet(var.vpc_cidr, 4, 1),
    cidrsubnet(var.vpc_cidr, 4, 2),
  ]

  # Application/worker subnets (private): 3x /26 = 192 addresses (75%)
  private_subnets = [
    cidrsubnet(var.vpc_cidr, 2, 1),
    cidrsubnet(var.vpc_cidr, 2, 2),
    cidrsubnet(var.vpc_cidr, 2, 3),
  ]
}

module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "6.6.1"

  name = var.vpc_name
  cidr = var.vpc_cidr

  azs             = var.azs
  public_subnets  = local.public_subnets
  private_subnets = local.private_subnets

  enable_nat_gateway   = true
  single_nat_gateway   = var.single_nat_gateway
  enable_dns_hostnames = true
  enable_dns_support   = true

  public_subnet_tags = {
    "kubernetes.io/role/elb" = "1"
    "subnet-type"            = "load-balancer"
  }

  private_subnet_tags = {
    "kubernetes.io/role/internal-elb" = "1"
    "subnet-type"                     = "application"
  }

  tags = var.tags
}
