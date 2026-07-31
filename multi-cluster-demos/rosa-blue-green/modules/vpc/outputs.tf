output "vpc_id" {
  value       = module.vpc.vpc_id
  description = "The VPC ID"
}

output "public_subnet_ids" {
  value       = module.vpc.public_subnets
  description = "List of public (load balancer) subnet IDs"
}

output "private_subnet_ids" {
  value       = module.vpc.private_subnets
  description = "List of private (application/worker) subnet IDs"
}

output "private_route_table_ids" {
  value       = module.vpc.private_route_table_ids
  description = "Private route table IDs for TGW route insertion"
}

output "availability_zones" {
  value       = var.azs
  description = "Availability zones used by this VPC"
}

output "vpc_cidr" {
  value       = module.vpc.vpc_cidr_block
  description = "The CIDR block of the VPC"
}
