variable "cluster_id" {
  type        = string
  description = "The ROSA HCP cluster ID (used to look up OIDC endpoint)"
}

variable "role_name_prefix" {
  type        = string
  description = "Prefix for the IAM role name"
}

variable "role_name" {
  type        = string
  description = "Descriptive name for the IAM role (appended to prefix)"
}

variable "namespace" {
  type        = string
  description = "Kubernetes namespace of the service account"
}

variable "service_account" {
  type        = string
  description = "Kubernetes service account name"
}

variable "policy_arns" {
  type        = list(string)
  description = "List of IAM policy ARNs to attach to the role"
}

variable "tags" {
  type        = map(string)
  default     = {}
  description = "Tags to apply to the IAM role"
}
