resource "osdgoogle_cluster" "cluster" {
  name                 = var.cluster_name
  cloud_region         = var.cloud_region
  gcp_project_id       = var.gcp_project_id
  version              = var.openshift_version
  compute_nodes        = var.compute_nodes
  compute_machine_type = var.compute_machine_type
}
