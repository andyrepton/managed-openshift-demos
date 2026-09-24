locals {
  # Built-in role definition GUIDs for ARO HCP
  role_ids = {
    service_managed_identity = "c0ff367d-66d8-445e-917c-583feb0ef0d4"
    cluster_api_provider     = "88366f10-ed47-4cc0-9fab-c8a06148393e"
    control_plane_operator   = "fc0c873f-45e9-4d0d-a7d1-585aab30c6ed"
    cloud_controller_manager = "a1f96423-95ce-4224-ab27-4e3dc72facd4"
    ingress_operator         = "0336e1d3-7a87-462b-b6db-342b63f7802c"
    file_storage_operator    = "0d7aedc0-15fd-4a67-a412-efad370c947e"
    image_registry_operator  = "8b32b316-c2f5-4ddf-b05b-83dacd2d08b5"
    network_operator         = "be7a6435-15ae-4171-8f30-4a343eff9e8f"
    key_vault_crypto_user    = "12338af0-0e69-4776-bea7-57ae8d297424"
    reader                   = "acdd72a7-3385-48ef-bd42-f606fba81ae7"
    federated_credential     = "ef318e2a-8334-4a05-9e4a-295a196c6a6e"
  }

  identity_names = {
    service                  = "${var.cluster_name}-service"
    cluster_api_azure        = "${var.cluster_name}-cluster-api-azure"
    control_plane            = "${var.cluster_name}-control-plane"
    cloud_controller_manager = "${var.cluster_name}-cloud-controller-manager"
    ingress                  = "${var.cluster_name}-ingress"
    disk_csi_driver          = "${var.cluster_name}-disk-csi-driver"
    file_csi_driver          = "${var.cluster_name}-file-csi-driver"
    image_registry           = "${var.cluster_name}-image-registry"
    cloud_network_config     = "${var.cluster_name}-cloud-network-config"
    kms                      = "${var.cluster_name}-kms"
    dp_disk_csi_driver       = "${var.cluster_name}-dp-disk-csi-driver"
    dp_file_csi_driver       = "${var.cluster_name}-dp-file-csi-driver"
    dp_image_registry        = "${var.cluster_name}-dp-image-registry"
  }

  identities = {
    service                  = azurerm_user_assigned_identity.service
    cluster_api_azure        = azurerm_user_assigned_identity.cluster_api_azure
    control_plane            = azurerm_user_assigned_identity.control_plane
    cloud_controller_manager = azurerm_user_assigned_identity.cloud_controller_manager
    ingress                  = azurerm_user_assigned_identity.ingress
    disk_csi_driver          = azurerm_user_assigned_identity.disk_csi_driver
    file_csi_driver          = azurerm_user_assigned_identity.file_csi_driver
    image_registry           = azurerm_user_assigned_identity.image_registry
    cloud_network_config     = azurerm_user_assigned_identity.cloud_network_config
    kms                      = azurerm_user_assigned_identity.kms
    dp_disk_csi_driver       = azurerm_user_assigned_identity.dp_disk_csi_driver
    dp_file_csi_driver       = azurerm_user_assigned_identity.dp_file_csi_driver
    dp_image_registry        = azurerm_user_assigned_identity.dp_image_registry
  }

  control_plane_operators = {
    "cluster-api-azure"        = azurerm_user_assigned_identity.cluster_api_azure.id
    "control-plane"            = azurerm_user_assigned_identity.control_plane.id
    "cloud-controller-manager" = azurerm_user_assigned_identity.cloud_controller_manager.id
    "ingress"                  = azurerm_user_assigned_identity.ingress.id
    "disk-csi-driver"          = azurerm_user_assigned_identity.disk_csi_driver.id
    "file-csi-driver"          = azurerm_user_assigned_identity.file_csi_driver.id
    "image-registry"           = azurerm_user_assigned_identity.image_registry.id
    "cloud-network-config"     = azurerm_user_assigned_identity.cloud_network_config.id
    "kms"                      = azurerm_user_assigned_identity.kms.id
  }

  data_plane_operators = {
    "disk-csi-driver" = azurerm_user_assigned_identity.dp_disk_csi_driver.id
    "file-csi-driver" = azurerm_user_assigned_identity.dp_file_csi_driver.id
    "image-registry"  = azurerm_user_assigned_identity.dp_image_registry.id
  }

  cluster_identity_ids = toset([
    azurerm_user_assigned_identity.service.id,
    azurerm_user_assigned_identity.cluster_api_azure.id,
    azurerm_user_assigned_identity.control_plane.id,
    azurerm_user_assigned_identity.cloud_controller_manager.id,
    azurerm_user_assigned_identity.ingress.id,
    azurerm_user_assigned_identity.disk_csi_driver.id,
    azurerm_user_assigned_identity.file_csi_driver.id,
    azurerm_user_assigned_identity.image_registry.id,
    azurerm_user_assigned_identity.cloud_network_config.id,
    azurerm_user_assigned_identity.kms.id,
  ])

  scopes = {
    vnet      = var.vnet_id
    nsg       = var.nsg_id
    subnet    = var.subnet_id
    key_vault = azurerm_key_vault.this.id
  }

  assignment_specs = [
    { key = "service-vnet", principal = "service", role = "service_managed_identity", scope = "vnet" },
    { key = "service-nsg", principal = "service", role = "service_managed_identity", scope = "nsg" },

    { key = "capi-vnet", principal = "cluster_api_azure", role = "cluster_api_provider", scope = "vnet" },
    { key = "service-reader-capi", principal = "service", role = "reader", scope_identity = "cluster_api_azure" },

    { key = "cp-vnet", principal = "control_plane", role = "control_plane_operator", scope = "vnet" },
    { key = "cp-nsg", principal = "control_plane", role = "control_plane_operator", scope = "nsg" },
    { key = "service-reader-cp", principal = "service", role = "reader", scope_identity = "control_plane" },

    { key = "ccm-vnet", principal = "cloud_controller_manager", role = "cloud_controller_manager", scope = "vnet" },
    { key = "ccm-nsg", principal = "cloud_controller_manager", role = "cloud_controller_manager", scope = "nsg" },
    { key = "service-reader-ccm", principal = "service", role = "reader", scope_identity = "cloud_controller_manager" },

    { key = "ingress-vnet", principal = "ingress", role = "ingress_operator", scope = "vnet" },
    { key = "service-reader-ingress", principal = "service", role = "reader", scope_identity = "ingress" },

    { key = "service-reader-disk-csi", principal = "service", role = "reader", scope_identity = "disk_csi_driver" },

    { key = "file-csi-vnet", principal = "file_csi_driver", role = "file_storage_operator", scope = "vnet" },
    { key = "file-csi-nsg", principal = "file_csi_driver", role = "file_storage_operator", scope = "nsg" },
    { key = "service-reader-file-csi", principal = "service", role = "reader", scope_identity = "file_csi_driver" },

    { key = "image-reg-vnet", principal = "image_registry", role = "image_registry_operator", scope = "vnet" },
    { key = "service-reader-image-reg", principal = "service", role = "reader", scope_identity = "image_registry" },

    { key = "cloud-net-subnet", principal = "cloud_network_config", role = "network_operator", scope = "subnet" },
    { key = "cloud-net-vnet", principal = "cloud_network_config", role = "network_operator", scope = "vnet" },
    { key = "service-reader-cloud-net", principal = "service", role = "reader", scope_identity = "cloud_network_config" },

    { key = "kms-kv", principal = "kms", role = "key_vault_crypto_user", scope = "key_vault" },
    { key = "service-reader-kms", principal = "service", role = "reader", scope_identity = "kms" },

    { key = "service-fed-dp-disk", principal = "service", role = "federated_credential", scope_identity = "dp_disk_csi_driver" },
    { key = "service-fed-dp-file", principal = "service", role = "federated_credential", scope_identity = "dp_file_csi_driver" },
    { key = "service-fed-dp-image", principal = "service", role = "federated_credential", scope_identity = "dp_image_registry" },

    { key = "dp-file-vnet", principal = "dp_file_csi_driver", role = "file_storage_operator", scope = "vnet" },
    { key = "dp-file-subnet", principal = "dp_file_csi_driver", role = "file_storage_operator", scope = "subnet" },
    { key = "dp-file-nsg", principal = "dp_file_csi_driver", role = "file_storage_operator", scope = "nsg" },

    { key = "dp-image-reg-vnet", principal = "dp_image_registry", role = "image_registry_operator", scope = "vnet" },
    { key = "dp-image-reg-subnet", principal = "dp_image_registry", role = "image_registry_operator", scope = "subnet" },
  ]

  assignment_specs_map = {
    for spec in local.assignment_specs : spec.key => spec
  }
}
