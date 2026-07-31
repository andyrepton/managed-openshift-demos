output "cluster_ids" {
  description = "Map of cluster key to cluster ID"
  value       = { for k, v in module.cluster : k => v.cluster_id }
}

output "vpc_ids" {
  description = "Map of cluster key to VPC ID"
  value       = { for k, v in module.vpc : k => v.vpc_id }
}

output "transit_gateway_id" {
  description = "Transit Gateway ID connecting all VPCs"
  value       = module.transit_gateway.transit_gateway_id
}

output "irsa_role_arns" {
  description = "Map of IRSA role key to role ARN"
  value       = { for k, v in module.irsa : k => v.role_arn }
}
