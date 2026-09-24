output "cluster_id" {
  description = "Azure resource ID of the HCP cluster."
  value       = module.cluster.cluster_id
}

output "api_url" {
  description = "Kubernetes API URL."
  value       = module.cluster.api_url
}

output "console_url" {
  description = "OpenShift console URL."
  value       = module.cluster.console_url
}

output "oidc_issuer_url" {
  description = "Cluster OIDC issuer URL."
  value       = module.cluster.oidc_issuer_url
}

output "dns_base_domain" {
  value = module.cluster.dns_base_domain
}

output "dns_base_domain_prefix" {
  value = module.cluster.dns_base_domain_prefix
}

output "resource_group_name" {
  value = module.network.resource_group_name
}

output "managed_resource_group_name" {
  value = module.cluster.managed_resource_group_name
}

output "node_pool_ids" {
  value = module.cluster.node_pool_ids
}

output "entra_client_id" {
  description = "Entra application (client) ID for OIDC login."
  value       = var.enable_external_auth ? module.entra[0].client_id : null
}

output "entra_issuer_url" {
  description = "OIDC issuer URL for Entra auth."
  value       = var.enable_external_auth ? module.entra[0].issuer_url : null
}

output "key_vault_name" {
  value = module.identities.key_vault_name
}
