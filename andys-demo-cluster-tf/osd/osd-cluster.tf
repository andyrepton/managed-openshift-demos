data "google_project" "project" {
  project_id = var.gcp_project_id
}

resource "osdgoogle_wif_config" "wif" {
  display_name      = "${var.cluster_name}-wif"
  openshift_version = var.openshift_version

  gcp = {
    project_id     = var.gcp_project_id
    project_number = tostring(data.google_project.project.number)
    role_prefix    = substr(replace(replace(var.cluster_name, "-", ""), "_", ""), 0, 8)
  }
}

module "wif_gcp" {
  source = "github.com/rh-mobb/terraform-provider-osd-google//modules/osd-wif-gcp"

  project_id   = var.gcp_project_id
  display_name = osdgoogle_wif_config.wif.display_name
  pool_id      = osdgoogle_wif_config.wif.gcp.workload_identity_pool.pool_id
  identity_provider = {
    identity_provider_id = osdgoogle_wif_config.wif.gcp.workload_identity_pool.identity_provider.identity_provider_id
    issuer_url           = osdgoogle_wif_config.wif.gcp.workload_identity_pool.identity_provider.issuer_url
    jwks                 = osdgoogle_wif_config.wif.gcp.workload_identity_pool.identity_provider.jwks
    allowed_audiences    = osdgoogle_wif_config.wif.gcp.workload_identity_pool.identity_provider.allowed_audiences
  }
  service_accounts         = osdgoogle_wif_config.wif.gcp.service_accounts
  support                  = osdgoogle_wif_config.wif.gcp.support
  impersonator_email       = osdgoogle_wif_config.wif.gcp.impersonator_email
  federated_project_id     = try(osdgoogle_wif_config.wif.gcp.federated_project_id, null) != "" ? try(osdgoogle_wif_config.wif.gcp.federated_project_id, null) : null
  federated_project_number = try(osdgoogle_wif_config.wif.gcp.federated_project_number, "") != "" ? osdgoogle_wif_config.wif.gcp.federated_project_number : tostring(data.google_project.project.number)
}

resource "osdgoogle_cluster" "cluster" {
  depends_on = [module.wif_gcp]

  name                 = var.cluster_name
  cloud_region         = var.cloud_region
  gcp_project_id       = var.gcp_project_id
  version              = var.openshift_version
  compute_nodes        = var.compute_nodes
  compute_machine_type = var.compute_machine_type
  ccs_enabled          = true
  wif_config_id        = osdgoogle_wif_config.wif.id
  wait_timeout         = 120
}
