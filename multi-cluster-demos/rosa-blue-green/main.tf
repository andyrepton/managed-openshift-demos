data "aws_availability_zones" "available" {}

locals {
  azs = slice(data.aws_availability_zones.available.names, 0, 3)

  clusters = merge([
    for pair_name, pair in var.cluster_pairs : {
      "${pair_name}-blue" = {
        pair_name                    = pair_name
        color                        = "blue"
        openshift_version            = pair.blue_version
        replicas                     = pair.replicas
        machine_type                 = pair.machine_type
        private                      = pair.private
        upgrade_acknowledgements_for = pair.upgrade_acknowledgements_for
        vpc_cidr                     = pair.blue_cidr
        machine_pools                = pair.machine_pools
      }
      "${pair_name}-green" = {
        pair_name                    = pair_name
        color                        = "green"
        openshift_version            = pair.green_version
        replicas                     = pair.replicas
        machine_type                 = pair.machine_type
        private                      = pair.private
        upgrade_acknowledgements_for = pair.upgrade_acknowledgements_for
        vpc_cidr                     = pair.green_cidr
        machine_pools                = pair.machine_pools
      }
    }
  ]...)
}

# --- VPCs (one per cluster) ---

module "vpc" {
  source   = "./modules/vpc"
  for_each = local.clusters

  vpc_name = "${var.cluster_name_prefix}-${each.key}"
  vpc_cidr = each.value.vpc_cidr
  azs      = local.azs
  tags = merge(var.tags, {
    "cluster-pair"  = each.value.pair_name
    "cluster-color" = each.value.color
  })
}

# --- ROSA HCP Clusters ---

module "cluster" {
  source   = "./modules/cluster"
  for_each = local.clusters

  cluster_name           = "${var.cluster_name_prefix}-${each.key}"
  openshift_version      = each.value.openshift_version
  replicas               = each.value.replicas
  compute_machine_type   = each.value.machine_type
  private                = each.value.private
  aws_availability_zones = module.vpc[each.key].availability_zones

  aws_subnet_ids = each.value.private ? module.vpc[each.key].private_subnet_ids : concat(
    module.vpc[each.key].public_subnet_ids,
    module.vpc[each.key].private_subnet_ids,
  )

  upgrade_acknowledgements_for = each.value.upgrade_acknowledgements_for

  machine_pools = {
    for k, pool in each.value.machine_pools : k => merge(pool, {
      subnet_id = module.vpc[each.key].private_subnet_ids[pool.subnet_index]
    })
  }

  tags = merge(var.tags, {
    "cluster-pair"  = each.value.pair_name
    "cluster-color" = each.value.color
  })
}

# --- Transit Gateway (connects all VPCs) ---

module "transit_gateway" {
  source = "./modules/transit-gateway"

  name = "${var.cluster_name_prefix}-tgw"

  vpc_attachments = {
    for k, v in module.vpc : k => {
      vpc_id                  = v.vpc_id
      subnet_ids              = v.private_subnet_ids
      vpc_cidr                = v.vpc_cidr
      private_route_table_ids = v.private_route_table_ids
    }
  }

  tags = var.tags
}

# --- IRSA Roles ---

module "irsa" {
  source   = "./modules/irsa"
  for_each = var.irsa_roles

  cluster_id       = module.cluster[each.value.cluster_key].cluster_id
  role_name_prefix = "${var.cluster_name_prefix}-${each.value.cluster_key}"
  role_name        = each.value.role_name
  namespace        = each.value.namespace
  service_account  = each.value.service_account
  policy_arns      = each.value.policy_arns
  tags             = var.tags
}
