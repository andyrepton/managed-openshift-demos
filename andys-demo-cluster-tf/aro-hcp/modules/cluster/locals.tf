locals {
  hcp_api_version             = "2026-06-30-preview"
  managed_resource_group_name = coalesce(var.managed_resource_group_name, "${var.cluster_name}-managed")

  hcp_enabled_versions = coalesce(try(data.azapi_resource_list.hcp_versions.output.enabled, null), [])

  hcp_cluster_versions = sort([
    for v in local.hcp_enabled_versions : v.name
    if try(v.channelGroup, "") == var.cluster_channel
  ])

  hcp_node_pool_versions = sort([
    for v in local.hcp_enabled_versions : v.name
    if try(v.channelGroup, "") == var.node_pool_channel
  ])

  hcp_node_pool_versions_for = {
    for name, p in local.node_pools : name => sort([
      for v in local.hcp_enabled_versions : v.name
      if try(v.channelGroup, "") == p.channel
    ])
  }

  hcp_cluster_streams = sort(distinct([
    for ver in local.hcp_cluster_versions : join(".", slice(split(".", ver), 0, 2))
    if length(split(".", ver)) >= 2
  ]))

  hcp_cluster_valid_versions = distinct(concat(local.hcp_cluster_streams, local.hcp_cluster_versions))

  node_pools = {
    for name, p in var.node_pools : name => {
      vm_size                   = p.vm_size
      replicas                  = p.replicas
      min_replicas              = p.min_replicas
      max_replicas              = p.max_replicas
      autoscaling               = p.min_replicas != null && p.max_replicas != null
      version                   = coalesce(p.version, var.node_pool_version)
      channel                   = coalesce(p.channel, var.node_pool_channel)
      disk_size_gib             = p.disk_size_gib
      disk_storage_account_type = p.disk_storage_account_type
      disk_type                 = p.disk_type
      disk_encryption_set       = p.disk_encryption_set
      availability_zone         = p.availability_zone
      encryption_at_host        = p.encryption_at_host
      subnet_id                 = p.subnet_id
      auto_repair               = p.auto_repair
      node_drain_timeout        = p.node_drain_timeout
      os_disk = merge(
        p.disk_size_gib != null ? { sizeGiB = p.disk_size_gib } : {},
        p.disk_storage_account_type != null ? { diskStorageAccountType = p.disk_storage_account_type } : {},
        p.disk_type != null ? { diskType = p.disk_type } : {},
        p.disk_encryption_set != null ? { encryptionSetId = p.disk_encryption_set } : {},
      )
      labels = [
        for k in sort(keys(p.labels)) : {
          key   = k
          value = p.labels[k]
        }
      ]
      taints = p.taints
      tags   = p.tags
    }
  }
}
