# ROSA (eu-west-2, g7e.2xlarge - L40S 96GB)
create_rosa                   = true
create_vpc                    = true
deploy_ai_machine_pool        = true
ai_gpu_instance_type          = "g7e.2xlarge"
ai_gpu_subnet_index           = 2
aws_region                    = "eu-west-2"
deploy_graviton_machine_pool  = false
deploy_lokistack_machine_pool = false
deploy_virt_machine_pool      = false
private_cluster               = false
rosa_cluster_name             = "poc-andyr1"

# ARO HCP (westeurope, H100)
create_aro_hcp                = true
aro_hcp_cluster_name          = "poc-andyr-hcp"
aro_hcp_location              = "westeurope"
aro_hcp_cluster_version       = "4.22"
aro_hcp_node_pool_version     = "4.22.15"
aro_hcp_api_visibility        = "Public"

aro_hcp_node_pools = {
  np-1 = {
    vm_size           = "Standard_D4s_v6"
    replicas          = 2
    availability_zone = "1"
  }
  ai-pool = {
    vm_size           = "Standard_D16s_v6"
    replicas          = 2
    availability_zone = "1"
  }
  gpu-pool = {
    vm_size           = "Standard_NC40ads_H100_v5"
    replicas          = 1
    availability_zone = "1"
    labels            = { "nvidia.com/gpu.present" = "true" }
    taints = [{
      key    = "nvidia.com/gpu"
      value  = "present"
      effect = "NoSchedule"
    }]
  }
}

# Disabled
create_aro = false
