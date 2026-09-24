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

