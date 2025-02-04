data "aws_availability_zones" "available" {}

locals {
  # Extract availability zone names for the specified region, limit it to 3 if multi az or 1 if single
  region_azs = var.multi_az ? slice([for zone in data.aws_availability_zones.available.names : format("%s", zone)], 0, 3) : slice([for zone in data.aws_availability_zones.available.names : format("%s", zone)], 0, 1)
}

resource "random_string" "random_name" {
  length  = 6
  special = false
  upper   = false
}

locals {
  path                 = coalesce(var.path, "/")
  worker_node_replicas = var.multi_az ? 3 : 2
  # If cluster_name is not null, use that, otherwise generate a random cluster name
  cluster_name = coalesce(var.cluster_name, "rosa-${random_string.random_name.result}")
}

# As we need to attach an additional AWS policy to the worker role, we need to make the account roles first

module "account_iam_resources" {
  source              = "terraform-redhat/rosa-hcp/rhcs//modules/account-iam-resources"
  version             = "1.6.3"
  account_role_prefix = local.cluster_name
}

resource "aws_iam_role_policy_attachment" "attach-ecr-policy" {
  role       = "${local.cluster_name}-HCP-ROSA-Worker-Role"
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
  depends_on = [module.account_iam_resources]
}

# Now make the cluster, using the account roles made above
module "rosa-hcp" {
  source                 = "terraform-redhat/rosa-hcp/rhcs"
  version                = "1.6.3"
  cluster_name           = local.cluster_name
  openshift_version      = var.openshift_version
  account_role_prefix    = local.cluster_name
  operator_role_prefix   = local.cluster_name
  replicas               = local.worker_node_replicas
  aws_availability_zones = local.region_azs
  create_oidc            = true
  private                = var.private_cluster
  aws_subnet_ids         = var.private_cluster ? module.vpc.private_subnets : concat(module.vpc.public_subnets, module.vpc.private_subnets)
  create_account_roles   = false
  create_operator_roles  = true
  properties = {
    rosa_creator_arn = data.aws_caller_identity.current.arn
    zero_egress      = true
  }

  depends_on = [aws_iam_role_policy_attachment.attach-ecr-policy, module.account_iam_resources]
}
