locals {
  resource_group_name          = coalesce(var.resource_group_name, "${var.cluster_name}-rg")
  vnet_name                    = coalesce(var.vnet_name, "${var.cluster_name}-vnet")
  subnet_name                  = coalesce(var.subnet_name, "${var.cluster_name}-worker")
  vnet_integration_subnet_name = coalesce(var.vnet_integration_subnet_name, "${var.cluster_name}-integration")
  nsg_name                     = coalesce(var.nsg_name, "${var.cluster_name}-nsg")
}

resource "azurerm_resource_group" "this" {
  name     = local.resource_group_name
  location = var.location
  tags     = var.tags
}

resource "azurerm_network_security_group" "this" {
  name                = local.nsg_name
  location            = azurerm_resource_group.this.location
  resource_group_name = azurerm_resource_group.this.name
  tags                = var.tags
}

resource "azurerm_virtual_network" "this" {
  name                = local.vnet_name
  location            = azurerm_resource_group.this.location
  resource_group_name = azurerm_resource_group.this.name
  address_space       = [var.address_prefix]
  tags                = var.tags
}

resource "azurerm_subnet" "worker" {
  name                              = local.subnet_name
  resource_group_name               = azurerm_resource_group.this.name
  virtual_network_name              = azurerm_virtual_network.this.name
  address_prefixes                  = [var.subnet_prefix]
  private_endpoint_network_policies = "Disabled"
  default_outbound_access_enabled   = true
}

resource "azurerm_subnet_network_security_group_association" "worker" {
  subnet_id                 = azurerm_subnet.worker.id
  network_security_group_id = azurerm_network_security_group.this.id
}

resource "azapi_resource" "vnet_integration_subnet" {
  type      = "Microsoft.Network/virtualNetworks/subnets@2023-05-01"
  name      = local.vnet_integration_subnet_name
  parent_id = azurerm_virtual_network.this.id

  body = {
    properties = {
      addressPrefix = var.vnet_integration_subnet_prefix
      delegations = [
        {
          name = "aro-hcp-delegation"
          properties = {
            serviceName = "Microsoft.RedHatOpenShift/hcpOpenShiftClusters"
          }
        }
      ]
    }
  }

  depends_on = [
    azurerm_virtual_network.this,
    azurerm_subnet.worker,
    azurerm_network_security_group.this,
    azurerm_subnet_network_security_group_association.worker,
  ]
}
