# One bare-metal worker for OpenShift Virtualization (demo-openshift-virt-on-osd).
# Tainted metal=true:NoSchedule so only workloads that tolerate it, which the
# demo's HyperConverged sets up for virtualization, land on it. Machine pools
# go through OCM; OSD does not let a customer create MachineSets directly.
#
# Not yet applied end to end (2026-11-05): the OSD build stopped earlier, on
# reserved GCP custom role IDs (see demo-openshift-virt-on-osd).
resource "osdgoogle_machine_pool" "virt" {
  count         = var.deploy_virt_machine_pool ? 1 : 0
  cluster_id    = osdgoogle_cluster.cluster.id
  name          = "virt"
  instance_type = var.virt_machine_type
  replicas      = 1
  labels        = { node_type = "metal" }
  taints = [{
    key    = "metal"
    value  = "true"
    effect = "NoSchedule"
  }]
}
