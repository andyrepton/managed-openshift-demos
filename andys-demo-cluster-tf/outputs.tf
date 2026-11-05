output "rhoai_aws_iam_access_key" {
  value = var.create_rosa && var.deploy_ai_machine_pool ? module.rosa[0].aws_iam_access_key : ""
}

output "rhoai_aws_iam_secret_key" {
  value     = var.create_rosa && var.deploy_ai_machine_pool ? module.rosa[0].aws_iam_secret_key : ""
  sensitive = true
}

output "aro_hcp_api_url" {
  value = var.create_aro_hcp ? module.aro_hcp[0].api_url : ""
}

output "aro_hcp_console_url" {
  value = var.create_aro_hcp ? module.aro_hcp[0].console_url : ""
}

output "aro_hcp_cluster_id" {
  value = var.create_aro_hcp ? module.aro_hcp[0].cluster_id : ""
}

output "osd_api_url" {
  value = var.create_osd ? module.osd[0].api_url : ""
}

output "osd_console_url" {
  value = var.create_osd ? module.osd[0].console_url : ""
}

output "bgp_iam_role_arn" {
  value = var.create_rosa && var.deploy_bgp ? module.rosa[0].bgp_iam_role_arn : ""
}

output "bgp_route_server_id" {
  value = var.create_rosa && var.deploy_bgp ? module.rosa[0].bgp_route_server_id : ""
}

output "bgp_route_server_asn" {
  value = var.create_rosa && var.deploy_bgp ? module.rosa[0].bgp_route_server_asn : ""
}

output "bgp_endpoint_ips" {
  value = var.create_rosa && var.deploy_bgp ? module.rosa[0].bgp_endpoint_ips : []
}

output "cloudwatch_iam_role_arn" {
  value = var.create_rosa && var.deploy_cloudwatch_logging ? module.rosa[0].cloudwatch_iam_role_arn : ""
}

output "lokistack_bucket_name" {
  value = var.create_rosa && var.deploy_lokistack_machine_pool ? module.rosa[0].lokistack_bucket_name : ""
}

output "lokistack_iam_role_arn" {
  value = var.create_rosa && var.deploy_lokistack_machine_pool ? module.rosa[0].lokistack_iam_role_arn : ""
}

output "ack_s3_iam_role_arn" {
  value = var.create_rosa && var.deploy_ack_s3 ? module.rosa[0].ack_s3_iam_role_arn : ""
}

output "cloudwatch_metrics_iam_role_arn" {
  value = var.create_rosa && var.deploy_cloudwatch_metrics ? module.rosa[0].cloudwatch_metrics_iam_role_arn : ""
}

output "autonode_iam_role_arn" {
  value = var.create_rosa && var.deploy_autonode ? module.rosa[0].autonode_iam_role_arn : ""
}
