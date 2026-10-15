module "bgp" {
  count  = var.deploy_bgp && var.create_vpc ? 1 : 0
  source = "./modules/bgp"

  cluster_name = local.cluster_name
  cluster_id   = module.rosa-hcp.cluster_id

  vpc_id                  = module.vpc[0].vpc_id
  private_subnets         = module.vpc[0].private_subnets
  private_route_table_ids = module.vpc[0].private_route_table_ids
  public_route_table_ids  = module.vpc[0].public_route_table_ids

  route_server_asn         = var.bgp_route_server_asn
  operator_namespace       = var.bgp_operator_namespace
  operator_service_account = var.bgp_operator_service_account
}

output "bgp_route_server_id" {
  value       = var.deploy_bgp && var.create_vpc ? module.bgp[0].route_server_id : ""
  description = "VPC Route Server ID."
}

output "bgp_route_server_asn" {
  value       = var.deploy_bgp && var.create_vpc ? module.bgp[0].route_server_asn : ""
  description = "VPC Route Server ASN."
}

output "bgp_endpoint_ips" {
  value       = var.deploy_bgp && var.create_vpc ? module.bgp[0].endpoint_ips : []
  description = "VPC Route Server endpoint IP addresses."
}

output "bgp_iam_role_arn" {
  value       = var.deploy_bgp && var.create_vpc ? module.bgp[0].iam_role_arn : ""
  description = "IAM role ARN for the bgp-cloud-connector operator."
}

output "bgp_security_group_ids" {
  value       = var.deploy_bgp && var.create_vpc ? module.bgp[0].security_group_ids : []
  description = "Security groups the BGP router machine pool needs attached."
}

# These resources used to sit directly in this module. The moved blocks let an
# existing state migrate into the module instead of destroying and recreating.
moved {
  from = aws_vpc_route_server.bgp[0]
  to   = module.bgp[0].aws_vpc_route_server.this
}

moved {
  from = aws_vpc_route_server_vpc_association.bgp[0]
  to   = module.bgp[0].aws_vpc_route_server_vpc_association.this
}

moved {
  from = aws_vpc_route_server_propagation.private
  to   = module.bgp[0].aws_vpc_route_server_propagation.private
}

moved {
  from = aws_vpc_route_server_propagation.public
  to   = module.bgp[0].aws_vpc_route_server_propagation.public
}

moved {
  from = aws_vpc_route_server_endpoint.bgp
  to   = module.bgp[0].aws_vpc_route_server_endpoint.this
}

moved {
  from = aws_security_group.bgp_rfc1918[0]
  to   = module.bgp[0].aws_security_group.rfc1918
}

moved {
  from = aws_security_group.bgp_allow_all[0]
  to   = module.bgp[0].aws_security_group.allow_all
}

moved {
  from = aws_iam_policy.bgp_cloud_connector[0]
  to   = module.bgp[0].aws_iam_policy.this
}

moved {
  from = aws_iam_role.bgp_cloud_connector[0]
  to   = module.bgp[0].aws_iam_role.this
}

moved {
  from = aws_iam_role_policy_attachment.bgp_cloud_connector[0]
  to   = module.bgp[0].aws_iam_role_policy_attachment.this
}
