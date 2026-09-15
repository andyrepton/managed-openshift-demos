locals {
  pull_secret = var.pull_secret_path != null && var.pull_secret_path != "" ? file(pathexpand(var.pull_secret_path)) : null
}

module "rosa" {
  count  = var.create_rosa ? 1 : 0
  source = "./rosa"

  cluster_name                  = var.cluster_name
  openshift_version             = var.rosa_openshift_version
  create_vpc                    = var.create_vpc
  private_cluster               = var.private_cluster
  multi_az                      = var.multi_az
  machine_type                  = var.machine_type
  worker_node_replicas          = var.worker_node_replicas
  path                          = var.path
  aws_region                    = var.aws_region
  aws_subnet_ids                = var.aws_subnet_ids
  vpc_name                      = var.vpc_name
  vpc_cidr_block                = var.vpc_cidr_block
  private_subnet_cidrs          = var.private_subnet_cidrs
  public_subnet_cidrs           = var.public_subnet_cidrs
  single_nat_gateway            = var.single_nat_gateway
  default_aws_tags              = var.default_aws_tags
  deploy_ai_machine_pool        = var.deploy_ai_machine_pool
  deploy_graviton_machine_pool  = var.deploy_graviton_machine_pool
  deploy_lokistack_machine_pool = var.deploy_lokistack_machine_pool
  deploy_virt_machine_pool      = var.deploy_virt_machine_pool
}

module "aro" {
  count             = var.create_aro ? 1 : 0
  source            = "./aro"
  subscription_id   = var.subscription_id
  domain            = var.domain
  cluster_name      = var.cluster_name
  openshift_version = var.aro_openshift_version
  tags              = var.default_azure_tags
  pull_secret       = local.pull_secret
}

module "osd" {
  count                = var.create_osd ? 1 : 0
  source               = "./osd"
  cluster_name         = var.cluster_name
  openshift_version    = var.osd_openshift_version
  gcp_project_id       = var.gcp_project_id
  cloud_region         = var.osd_cloud_region
  compute_nodes        = var.osd_compute_nodes
  compute_machine_type = var.osd_compute_machine_type
}
