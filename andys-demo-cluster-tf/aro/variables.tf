variable "subscription_id" {
  type        = string
  description = "Azure Subscription ID for your cluster"
}

variable "cluster_name" {
  type        = string
  default     = "my-aro-cluster"
  description = "ARO cluster name"
}

variable "tags" {
  type = map(string)
  default = {
    environment = "development"
    owner       = "your@email.address"
  }
}

variable "location" {
  type        = string
  default     = "westeurope"
  description = "Azure region"
}

variable "pull_secret" {
  type        = string
  default     = null
  description = <<EOF
  Pull Secret for the ARO cluster
  Default null
  EOF
}

variable "cluster_version" {
  type        = string
  description = <<EOF
  ARO version
  Default "4.16.30"
  EOF
  default     = "4.16.30"
}

variable "domain" {
  type = string
  description = "The domain for the ARO cluster to use"
}
