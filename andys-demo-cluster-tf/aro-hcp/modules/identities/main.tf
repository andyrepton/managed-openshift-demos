data "azurerm_client_config" "current" {}

resource "azurerm_user_assigned_identity" "service" {
  name                = local.identity_names.service
  location            = var.location
  resource_group_name = var.resource_group_name
  tags                = var.tags
}

resource "azurerm_user_assigned_identity" "cluster_api_azure" {
  name                = local.identity_names.cluster_api_azure
  location            = var.location
  resource_group_name = var.resource_group_name
  tags                = var.tags
}

resource "azurerm_user_assigned_identity" "control_plane" {
  name                = local.identity_names.control_plane
  location            = var.location
  resource_group_name = var.resource_group_name
  tags                = var.tags
}

resource "azurerm_user_assigned_identity" "cloud_controller_manager" {
  name                = local.identity_names.cloud_controller_manager
  location            = var.location
  resource_group_name = var.resource_group_name
  tags                = var.tags
}

resource "azurerm_user_assigned_identity" "ingress" {
  name                = local.identity_names.ingress
  location            = var.location
  resource_group_name = var.resource_group_name
  tags                = var.tags
}

resource "azurerm_user_assigned_identity" "disk_csi_driver" {
  name                = local.identity_names.disk_csi_driver
  location            = var.location
  resource_group_name = var.resource_group_name
  tags                = var.tags
}

resource "azurerm_user_assigned_identity" "file_csi_driver" {
  name                = local.identity_names.file_csi_driver
  location            = var.location
  resource_group_name = var.resource_group_name
  tags                = var.tags
}

resource "azurerm_user_assigned_identity" "image_registry" {
  name                = local.identity_names.image_registry
  location            = var.location
  resource_group_name = var.resource_group_name
  tags                = var.tags
}

resource "azurerm_user_assigned_identity" "cloud_network_config" {
  name                = local.identity_names.cloud_network_config
  location            = var.location
  resource_group_name = var.resource_group_name
  tags                = var.tags
}

resource "azurerm_user_assigned_identity" "kms" {
  name                = local.identity_names.kms
  location            = var.location
  resource_group_name = var.resource_group_name
  tags                = var.tags
}

resource "azurerm_user_assigned_identity" "dp_disk_csi_driver" {
  name                = local.identity_names.dp_disk_csi_driver
  location            = var.location
  resource_group_name = var.resource_group_name
  tags                = var.tags
}

resource "azurerm_user_assigned_identity" "dp_file_csi_driver" {
  name                = local.identity_names.dp_file_csi_driver
  location            = var.location
  resource_group_name = var.resource_group_name
  tags                = var.tags
}

resource "azurerm_user_assigned_identity" "dp_image_registry" {
  name                = local.identity_names.dp_image_registry
  location            = var.location
  resource_group_name = var.resource_group_name
  tags                = var.tags
}

resource "azurerm_role_assignment" "this" {
  for_each = local.assignment_specs_map

  scope                            = try(each.value.scope_identity, null) != null ? local.identities[each.value.scope_identity].id : local.scopes[each.value.scope]
  role_definition_id               = "/subscriptions/${data.azurerm_client_config.current.subscription_id}/providers/Microsoft.Authorization/roleDefinitions/${local.role_ids[each.value.role]}"
  principal_id                     = local.identities[each.value.principal].principal_id
  principal_type                   = "ServicePrincipal"
  skip_service_principal_aad_check = true
}
