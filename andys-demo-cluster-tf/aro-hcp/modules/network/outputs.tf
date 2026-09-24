output "resource_group_name" {
  value = azurerm_resource_group.this.name
}

output "resource_group_id" {
  value = azurerm_resource_group.this.id
}

output "location" {
  value = azurerm_resource_group.this.location
}

output "vnet_id" {
  value = azurerm_virtual_network.this.id
}

output "worker_subnet_id" {
  value = azurerm_subnet.worker.id
}

output "vnet_integration_subnet_id" {
  value = azapi_resource.vnet_integration_subnet.id
}

output "nsg_id" {
  value = azurerm_network_security_group.this.id
}

output "address_prefix" {
  value = var.address_prefix
}
