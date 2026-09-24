module "network" {
  source = "./modules/network"

  location                       = var.location
  cluster_name                   = var.cluster_name
  address_prefix                 = var.address_prefix
  subnet_prefix                  = var.subnet_prefix
  vnet_integration_subnet_prefix = var.vnet_integration_subnet_prefix
  tags                           = var.tags
}

module "identities" {
  source = "./modules/identities"

  cluster_name        = var.cluster_name
  resource_group_name = module.network.resource_group_name
  location            = module.network.location
  vnet_id             = module.network.vnet_id
  nsg_id              = module.network.nsg_id
  subnet_id           = module.network.worker_subnet_id
  pull_secret_content = length(trimspace(var.pull_secret_path)) > 0 ? file(var.pull_secret_path) : ""
  tags                = var.tags
}

data "azuread_client_config" "current" {}

module "cluster" {
  source = "./modules/cluster"

  cluster_name               = var.cluster_name
  resource_group_name        = module.network.resource_group_name
  resource_group_id          = module.network.resource_group_id
  location                   = module.network.location
  address_prefix             = module.network.address_prefix
  worker_subnet_id           = module.network.worker_subnet_id
  vnet_integration_subnet_id = module.network.vnet_integration_subnet_id
  nsg_id                     = module.network.nsg_id
  key_vault_name             = module.identities.key_vault_name
  etcd_key_version           = module.identities.etcd_key_version
  etcd_encryption_key_name   = module.identities.etcd_encryption_key_name
  service_identity_id        = module.identities.service_identity_id
  control_plane_operators    = module.identities.control_plane_operators
  data_plane_operators       = module.identities.data_plane_operators
  cluster_identity_ids       = module.identities.cluster_identity_ids
  cluster_version            = var.cluster_version
  cluster_channel            = var.cluster_channel
  api_visibility             = var.api_visibility
  ingress_visibility         = var.ingress_visibility
  outbound_type              = var.outbound_type
  vault_visibility           = var.vault_visibility
  pod_cidr                   = var.pod_cidr
  service_cidr               = var.service_cidr
  host_prefix                = var.host_prefix
  node_pool_version          = var.node_pool_version
  node_pool_channel          = var.node_pool_channel
  node_pools                 = var.node_pools
  tags                       = var.tags

  depends_on = [module.identities]
}

module "entra" {
  count  = var.enable_external_auth ? 1 : 0
  source = "github.com/rh-mobb/validated-pattern-aro-hcp//modules/entra"

  cluster_name           = var.cluster_name
  cluster_id             = module.cluster.cluster_id
  console_url            = module.cluster.console_url
  dns_base_domain        = module.cluster.dns_base_domain
  dns_base_domain_prefix = module.cluster.dns_base_domain_prefix
  tenant_id              = data.azuread_client_config.current.tenant_id
  key_vault_id           = module.identities.key_vault_id
  oidc_web_redirects     = {}
}

resource "null_resource" "console_secret" {
  count = var.enable_external_auth ? 1 : 0

  triggers = {
    external_auth_id = module.entra[0].external_auth_id
  }

  provisioner "local-exec" {
    command = <<-EOT
      set -euo pipefail
      RG="${var.cluster_name}-rg"
      SECRET_VALUE=$(az keyvault secret show \
        --vault-name "${module.identities.key_vault_name}" \
        --name "${module.entra[0].client_secret_key_vault_secret_name}" \
        --query value -o tsv)
      az aro hcp cluster request-credential --admin \
        --name "${var.cluster_name}" \
        --resource-group "$RG" \
        --file /tmp/aro-hcp-kubeconfig-entra
      KUBECONFIG=/tmp/aro-hcp-kubeconfig-entra oc create secret generic \
        entra-console-openshift-console \
        --namespace openshift-config \
        --from-literal=clientSecret="$SECRET_VALUE" \
        --dry-run=client -o yaml | \
        KUBECONFIG=/tmp/aro-hcp-kubeconfig-entra oc apply -f -
      rm -f /tmp/aro-hcp-kubeconfig-entra
    EOT
  }

  depends_on = [module.entra]
}

resource "null_resource" "cluster_admin_rbac" {
  count = var.enable_external_auth ? 1 : 0

  triggers = {
    external_auth_id = module.entra[0].external_auth_id
  }

  provisioner "local-exec" {
    command = <<-EOT
      set -euo pipefail
      RG="${var.cluster_name}-rg"
      EMAIL=$(az ad signed-in-user show --query userPrincipalName -o tsv)
      az aro hcp cluster request-credential --admin \
        --name "${var.cluster_name}" \
        --resource-group "$RG" \
        --file /tmp/aro-hcp-kubeconfig-rbac
      KUBECONFIG=/tmp/aro-hcp-kubeconfig-rbac oc apply -f - <<EOF
      apiVersion: rbac.authorization.k8s.io/v1
      kind: ClusterRoleBinding
      metadata:
        name: entra-cluster-admin
      subjects:
        - kind: User
          apiGroup: rbac.authorization.k8s.io
          name: "$EMAIL"
      roleRef:
        kind: ClusterRole
        name: cluster-admin
        apiGroup: rbac.authorization.k8s.io
      EOF
      rm -f /tmp/aro-hcp-kubeconfig-rbac
    EOT
  }

  depends_on = [null_resource.console_secret]
}
