variable "openshift_version" {
  type        = string
  default     = "4.16.4"
  description = "Desired version of OpenShift for the cluster, for example '4.1.0'. If version is greater than the currently running version, an upgrade will be scheduled."
}

variable "aws_region" {
  type        = string
  description = "The AWS Region of the cluster"
}

# ROSA Cluster info
variable "cluster_name" {
  default     = null
  type        = string
  description = "The name of the ROSA cluster to create"
}

variable "tags" {
  default = {
    Terraform   = "true"
    Environment = "dev"
    TFOwner     = "mobb@redhat.com"
  }
  description = "Additional AWS resource tags"
  type        = map(string)
}

variable "subnet_id" {
  type        = string
  description = "Subnet for the machine pool"
}

variable "cluster_id" {
  type        = string
  description = "ID of the cluster"
}
