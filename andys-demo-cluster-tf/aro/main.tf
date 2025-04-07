data "azurerm_client_config" "aro" {}

data "azuread_client_config" "aro" {}

resource "azuread_application" "aro" {
  display_name = var.cluster_name
}

resource "azuread_service_principal" "aro" {
  client_id = azuread_application.aro.client_id
}

resource "azuread_service_principal_password" "aro" {
  service_principal_id = azuread_service_principal.aro.object_id
}

data "azuread_service_principal" "redhatopenshift" {
  // This is the Azure Red Hat OpenShift RP service principal id, do NOT delete it
#  client_id = "f1dd0a37-89c6-4e07-bcd1-ffd3d43d8875"
  display_name = "Azure Red Hat OpenShift RP"
}

resource "azurerm_role_assignment" "role_network1" {
  scope                = azurerm_virtual_network.aro.id
  role_definition_name = "Network Contributor"
  principal_id         = azuread_service_principal.aro.object_id
}

resource "azurerm_role_assignment" "role_network2" {
  scope                = azurerm_virtual_network.aro.id
  role_definition_name = "Network Contributor"
  principal_id         = data.azuread_service_principal.redhatopenshift.object_id
}

resource "azurerm_resource_group" "aro" {
  name     = "${var.cluster_name}-rg"
  location = "West Europe"
}
