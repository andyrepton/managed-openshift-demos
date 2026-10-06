create_vpc                    = true
deploy_ai_machine_pool        = true
ai_gpu_instance_type          = "g7e.2xlarge"
ai_gpu_subnet_index           = 2
aws_region                    = "us-east-2"
deploy_graviton_machine_pool  = false
deploy_lokistack_machine_pool = false
deploy_virt_machine_pool      = false
private_cluster               = false

rosa_cluster_name = "poc-andyr1"

create_aro  = false
create_rosa = true
