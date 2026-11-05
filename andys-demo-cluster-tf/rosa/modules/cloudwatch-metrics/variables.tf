variable "cluster_id" {
  type        = string
  description = "ID of the cluster"
}

variable "cluster_name" {
  type        = string
  description = "The name of the ROSA cluster, used to name the IAM role"
}

variable "namespace" {
  type        = string
  default     = "amazon-cloudwatch"
  description = "Namespace of the ServiceAccount allowed to assume the role"
}

variable "service_account" {
  type        = string
  default     = "cwagent-prometheus"
  description = "ServiceAccount allowed to assume the role"
}
