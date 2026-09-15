resource "azurerm_redhat_openshift_cluster" "aro" {
  name                = var.cluster_name
  location            = azurerm_resource_group.aro.location
  resource_group_name = azurerm_resource_group.aro.name
  tags                = var.tags

  lifecycle {
    create_before_destroy = false
  }

  cluster_profile {
    domain      = "${var.cluster_name}.${var.domain}"
    version     = var.openshift_version
    pull_secret = var.pull_secret
  }

  network_profile {
    pod_cidr     = "10.128.0.0/14"
    service_cidr = "172.30.0.0/16"
  }

  main_profile {
    vm_size   = "Standard_D8s_v3"
    subnet_id = azurerm_subnet.main_subnet.id
  }

  api_server_profile {
    visibility = "Public"
  }

  ingress_profile {
    visibility = "Public"
  }

  worker_profile {
    vm_size      = "Standard_D4s_v3"
    disk_size_gb = 128
    node_count   = 3
    subnet_id    = azurerm_subnet.worker_subnet.id
  }

  service_principal {
    client_id     = azuread_application.aro.client_id
    client_secret = azuread_service_principal_password.aro.value
  }
}

output "console_url" {
  value = azurerm_redhat_openshift_cluster.aro.console_url
}

resource "azurerm_dns_a_record" "api" {
  name                = "api.${var.cluster_name}"
  zone_name           = var.dns_zone_name
  resource_group_name = var.dns_zone_resource_group
  ttl                 = 300
  records             = [azurerm_redhat_openshift_cluster.aro.api_server_profile[0].ip_address]
}

resource "azurerm_dns_a_record" "apps" {
  name                = "*.apps.${var.cluster_name}"
  zone_name           = var.dns_zone_name
  resource_group_name = var.dns_zone_resource_group
  ttl                 = 300
  records             = [azurerm_redhat_openshift_cluster.aro.ingress_profile[0].ip_address]
}
