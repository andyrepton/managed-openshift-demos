create_vpc                    = true
deploy_ai_machine_pool        = true
deploy_graviton_machine_pool  = false
deploy_lokistack_machine_pool = true
deploy_virt_machine_pool      = false
private_cluster               = false

rosa_cluster_name  = "poc-andyr"
rosa_openshift_version = "4.20.11"

create_aro  = false
create_rosa = true
