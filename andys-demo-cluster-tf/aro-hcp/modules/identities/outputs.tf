output "service_identity_id" {
  value = azurerm_user_assigned_identity.service.id
}

output "control_plane_operators" {
  value = local.control_plane_operators
}

output "data_plane_operators" {
  value = local.data_plane_operators
}

output "cluster_identity_ids" {
  value = local.cluster_identity_ids
}

output "key_vault_name" {
  value = azurerm_key_vault.this.name
}

output "key_vault_id" {
  value = azurerm_key_vault.this.id
}

output "etcd_key_version" {
  value = azurerm_key_vault_key.etcd_encryption.version
}

output "etcd_encryption_key_name" {
  value = local.etcd_encryption_key_name
}

output "pull_secret_key_vault_secret_name" {
  value = var.pull_secret_key_vault_secret_name
}
