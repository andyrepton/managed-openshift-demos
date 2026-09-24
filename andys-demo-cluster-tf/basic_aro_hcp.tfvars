create_aro_hcp = true
create_rosa    = false
create_aro     = false
create_osd     = false

aro_hcp_cluster_name      = "poc-andyr-hcp"
aro_hcp_location          = "westeurope"
aro_hcp_cluster_version   = "4.22"
aro_hcp_node_pool_version = "4.22.13"
aro_hcp_api_visibility    = "Public"

aro_hcp_node_pools = {
  np-1 = {
    vm_size           = "Standard_D4s_v6"
    replicas          = 2
    availability_zone = "1"
  }
}
