output "cluster_id" {
  description = "Azure resource ID of the HCP cluster."
  value       = azapi_resource.hcp_cluster.id
}

output "api_url" {
  description = "Kubernetes API URL."
  value       = try(azapi_resource.hcp_cluster.output.properties.api.url, null)
}

output "console_url" {
  description = "OpenShift console URL."
  value       = try(azapi_resource.hcp_cluster.output.properties.console.url, null)
}

output "oidc_issuer_url" {
  description = "Cluster OIDC issuer for workload-identity federated credentials."
  value       = try(azapi_resource.hcp_cluster.output.properties.platform.issuerUrl, null)
}

output "dns_base_domain" {
  description = "Service-assigned HCP DNS zone."
  value       = try(azapi_resource.hcp_cluster.output.properties.dns.baseDomain, null)
}

output "dns_base_domain_prefix" {
  description = "DNS label for the cluster."
  value       = try(azapi_resource.hcp_cluster.output.properties.dns.baseDomainPrefix, null)
}

output "managed_resource_group_name" {
  value = local.managed_resource_group_name
}

output "node_pool_ids" {
  description = "Azure resource IDs of HCP nodePools keyed by pool name."
  value       = { for name, r in azapi_resource.node_pool : name => r.id }
}
