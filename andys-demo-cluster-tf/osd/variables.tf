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
  default     = "4.18.1"
  description = "OpenShift version for the OSD cluster."
}

variable "compute_nodes" {
  type        = number
  default     = 3
  description = "Number of compute nodes."
}

variable "compute_machine_type" {
  type        = string
  default     = "custom-4-16384"
  description = "GCP machine type for compute nodes."
}
