data "azurerm_client_config" "current" {}

data "azapi_resource_list" "hcp_versions" {
  type      = "Microsoft.RedHatOpenShift/locations/hcpOpenShiftVersions@${local.hcp_api_version}"
  parent_id = "/subscriptions/${data.azurerm_client_config.current.subscription_id}/providers/Microsoft.RedHatOpenShift/locations/${var.location}"
  response_export_values = {
    enabled = "value[?properties.enabled].{name: name, channelGroup: properties.channelGroup}"
  }
}

resource "azapi_resource" "hcp_cluster" {
  type                      = "Microsoft.RedHatOpenShift/hcpOpenShiftClusters@${local.hcp_api_version}"
  parent_id                 = var.resource_group_id
  name                      = var.cluster_name
  location                  = var.location
  schema_validation_enabled = false
  tags                      = var.tags

  identity {
    type         = "UserAssigned"
    identity_ids = tolist(var.cluster_identity_ids)
  }

  body = {
    properties = {
      version = {
        id           = var.cluster_version
        channelGroup = var.cluster_channel
      }
      dns = {}
      network = {
        networkType = "OVNKubernetes"
        podCidr     = var.pod_cidr
        serviceCidr = var.service_cidr
        machineCidr = var.address_prefix
        hostPrefix  = var.host_prefix
      }
      etcd = {
        dataEncryption = {
          keyManagementMode = "CustomerManaged"
          customerManaged = {
            encryptionType = "KMS"
            kms = {
              activeKey = {
                name    = var.etcd_encryption_key_name
                version = var.etcd_key_version
              }
              vaultName  = var.key_vault_name
              visibility = var.vault_visibility
            }
          }
        }
      }
      api = {
        visibility = var.api_visibility
      }
      ingress = {
        type = var.ingress_visibility
      }
      platform = {
        managedResourceGroup    = local.managed_resource_group_name
        subnetId                = var.worker_subnet_id
        vnetIntegrationSubnetId = var.vnet_integration_subnet_id
        outboundType            = var.outbound_type
        networkSecurityGroupId  = var.nsg_id
        operatorsAuthentication = {
          userAssignedIdentities = {
            controlPlaneOperators  = var.control_plane_operators
            dataPlaneOperators     = var.data_plane_operators
            serviceManagedIdentity = var.service_identity_id
          }
        }
      }
    }
  }

  response_export_values = ["properties"]

  timeouts {
    create = "120m"
    update = "120m"
    delete = "120m"
  }

  lifecycle {
    precondition {
      condition     = contains(local.hcp_cluster_streams, var.cluster_version)
      error_message = "cluster_version ${var.cluster_version} is not an enabled ${var.cluster_channel} stream in ${var.location}. Available: ${join(", ", local.hcp_cluster_streams)}."
    }
  }
}

resource "azapi_resource" "node_pool" {
  for_each = local.node_pools

  type                      = "Microsoft.RedHatOpenShift/hcpOpenShiftClusters/nodePools@${local.hcp_api_version}"
  parent_id                 = azapi_resource.hcp_cluster.id
  name                      = each.key
  location                  = var.location
  schema_validation_enabled = false
  tags                      = merge(var.tags, each.value.tags)

  body = {
    properties = merge(
      {
        version = {
          id           = each.value.version
          channelGroup = each.value.channel
        }
        platform = merge(
          {
            vmSize = each.value.vm_size
          },
          each.value.subnet_id != null ? { subnetId = each.value.subnet_id } : {},
          length(each.value.os_disk) > 0 ? { osDisk = each.value.os_disk } : {},
          each.value.availability_zone != null ? { availabilityZone = each.value.availability_zone } : {},
          each.value.encryption_at_host != null ? { enableEncryptionAtHost = each.value.encryption_at_host } : {},
        )
      },
      each.value.auto_repair != null ? { autoRepair = each.value.auto_repair } : {},
      each.value.autoscaling ? {
        autoScaling = {
          min = each.value.min_replicas
          max = each.value.max_replicas
        }
      } : {},
      each.value.autoscaling ? {} : { replicas = each.value.replicas },
      length(each.value.labels) > 0 ? { labels = each.value.labels } : {},
      length(each.value.taints) > 0 ? { taints = each.value.taints } : {},
      each.value.node_drain_timeout != null ? { nodeDrainTimeoutMinutes = each.value.node_drain_timeout } : {},
    )
  }

  timeouts {
    create = "90m"
    update = "90m"
    delete = "90m"
  }

  lifecycle {
    precondition {
      condition     = contains(local.hcp_node_pool_versions_for[each.key], each.value.version)
      error_message = "node pool ${each.key} version ${each.value.version} is not an enabled ${each.value.channel} version in ${var.location}. Available: ${join(", ", local.hcp_node_pool_versions_for[each.key])}."
    }
  }
}
