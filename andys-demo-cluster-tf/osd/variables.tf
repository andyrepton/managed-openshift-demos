variable "cluster_name" {
  type        = string
  description = "OSD cluster name."
}

variable "cloud_region" {
  type        = string
  default     = "us-central1"
  description = "GCP region for the OSD cluster."
}

variable "gcp_project_id" {
  type        = string
  description = "GCP project ID."
}


variable "openshift_version" {
  type        = string
  default     = "4.22.13"
  description = "OpenShift version for the OSD cluster."
}

variable "compute_nodes" {
  type        = number
  default     = 4
  description = "Number of compute nodes. Minimum 4."
}

variable "compute_machine_type" {
  type        = string
  default     = "custom-4-16384"
  description = "GCP machine type for compute nodes."
}

variable "deploy_virt_machine_pool" {
  type        = bool
  default     = false
  description = "Add a bare-metal machine pool for OpenShift Virtualization."
}

variable "virt_machine_type" {
  type        = string
  default     = "c3-standard-192-metal"
  description = "GCP bare-metal machine type for the virtualization pool."
}
