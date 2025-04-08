data "azuread_client_config" "aro" {}

resource "azuread_application" "aro" {
  display_name = var.cluster_name
  owners       = [data.azuread_client_config.aro.object_id]
}

resource "azuread_service_principal" "aro" {
  client_id = azuread_application.aro.client_id
  owners    = [data.azuread_client_config.aro.object_id]
}

resource "azuread_service_principal_password" "aro" {
  service_principal_id = azuread_service_principal.aro.id
  display_name         = var.cluster_name
}

resource "azurerm_role_assignment" "aro_net_contributor" {
  scope                = azurerm_virtual_network.aro.id
  role_definition_name = "Network Contributor"
  principal_id         = azuread_service_principal.aro.object_id
}

data "azuread_service_principal" "redhatopenshift" {
  // This is the Azure Red Hat OpenShift RP service principal id, do NOT delete it
  client_id = "f1dd0a37-89c6-4e07-bcd1-ffd3d43d8875"
}

resource "azurerm_role_assignment" "redhat_net_contributor" {
  scope                = azurerm_virtual_network.aro.id
  role_definition_name = "Network Contributor"
  principal_id         = data.azuread_service_principal.redhatopenshift.object_id
}

resource "azurerm_resource_group" "aro" {
  name     = "${var.cluster_name}-rg"
  location = "West Europe"
  tags     = var.tags
}
