output "transit_gateway_id" {
  value       = module.transit_gateway.ec2_transit_gateway_id
  description = "The ID of the transit gateway"
}

output "vpc_attachment_ids" {
  value       = module.transit_gateway.ec2_transit_gateway_vpc_attachment_ids
  description = "Map of VPC attachment IDs"
}
