module "rosa-ai-machine-pool" {
  count = var.deploy_ai_machine_pool ? 1 : 0
  source = "terraform-redhat/rosa-hcp/rhcs//modules/machine-pool"
  version = "1.6.3"

  cluster_id = module.rosa-hcp.cluster_id
  name = "${local.cluster_name}-ai"
  openshift_version = var.openshift_version

  aws_node_pool = {
    instance_type = "m5.xlarge"
    tags = var.default_aws_tags
  }

  subnet_id = module.vpc[0].private_subnets[0]
  autoscaling = {
    enabled = false
    min_replicas = null
    max_replicas = null
  }

  taints = [{
    key = "NotebooksOnly",
    value = "yes",
    schedule_type = "NoSchedule"
  }]
  replicas = 2
}
