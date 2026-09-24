locals {
  etcd_encryption_key_name = "etcd-data-kms-encryption-key"
  have_pull_secret         = length(trimspace(var.pull_secret_content)) > 0
}

resource "random_string" "key_vault_suffix" {
  length  = 13
  lower   = true
  upper   = false
  numeric = true
  special = false
}

resource "azurerm_key_vault" "this" {
  name                          = "cust-kv-${random_string.key_vault_suffix.result}"
  location                      = var.location
  resource_group_name           = var.resource_group_name
  tenant_id                     = data.azurerm_client_config.current.tenant_id
  sku_name                      = "standard"
  soft_delete_retention_days    = 7
  purge_protection_enabled      = false
  enable_rbac_authorization     = true
  public_network_access_enabled = true
  tags                          = var.tags

  lifecycle {
    ignore_changes = [soft_delete_retention_days]
  }
}

resource "azurerm_role_assignment" "deployer_key_vault_admin" {
  scope                = azurerm_key_vault.this.id
  role_definition_name = "Key Vault Administrator"
  principal_id         = data.azurerm_client_config.current.object_id
}

resource "azurerm_key_vault_secret" "pull_secret" {
  count = local.have_pull_secret ? 1 : 0

  depends_on = [azurerm_role_assignment.deployer_key_vault_admin]

  name         = var.pull_secret_key_vault_secret_name
  value        = var.pull_secret_content
  key_vault_id = azurerm_key_vault.this.id
}

resource "azurerm_key_vault_key" "etcd_encryption" {
  depends_on = [azurerm_role_assignment.deployer_key_vault_admin]

  name         = local.etcd_encryption_key_name
  key_vault_id = azurerm_key_vault.this.id
  key_type     = "RSA"
  key_size     = 2048
  key_opts = [
    "decrypt",
    "encrypt",
    "sign",
    "unwrapKey",
    "verify",
    "wrapKey",
  ]
}
