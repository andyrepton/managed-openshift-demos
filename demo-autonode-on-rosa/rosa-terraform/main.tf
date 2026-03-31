module "rosa" {
  source                        = "../../andys-demo-cluster-tf/rosa"
  create_vpc                    = true
  deploy_ai_machine_pool        = false
  deploy_graviton_machine_pool  = false
  deploy_lokistack_machine_pool = false
  deploy_virt_machine_pool      = false
  private_cluster               = false
  cluster_name                  = "andyr-autonode"
  openshift_version             = var.openshift_version
  properties                    = { provision_shard_id = "9f11dd2b-98c1-11f0-8fe5-0a580a830a08", rosa_creator_arn = data.aws_caller_identity.current.arn }
}

output "cluster_id" {
  value       = module.rosa.cluster_id
  description = "Unique identifier of the cluster."
}
