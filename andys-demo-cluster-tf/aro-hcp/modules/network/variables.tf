variable "location" {
  description = "Azure region for all resources."
  type        = string
}

variable "cluster_name" {
  description = "ARO HCP cluster name (also used for resource naming)."
  type        = string
}

variable "resource_group_name" {
  description = "Customer resource group name. Defaults to <cluster_name>-rg."
  type        = string
  default     = null
  nullable    = true
}

variable "vnet_name" {
  description = "Virtual network name. Defaults to <cluster_name>-vnet."
  type        = string
  default     = null
  nullable    = true
}

variable "subnet_name" {
  description = "Worker subnet name. Defaults to <cluster_name>-worker."
  type        = string
  default     = null
  nullable    = true
}

variable "vnet_integration_subnet_name" {
  description = "VNet integration subnet name. Defaults to <cluster_name>-integration."
  type        = string
  default     = null
  nullable    = true
}

variable "nsg_name" {
  description = "Network security group name. Defaults to <cluster_name>-nsg."
  type        = string
  default     = null
  nullable    = true
}

variable "address_prefix" {
  description = "VNet address prefix."
  type        = string
  default     = "10.0.0.0/16"
}

variable "subnet_prefix" {
  description = "Worker subnet address prefix."
  type        = string
  default     = "10.0.0.0/24"
}

variable "vnet_integration_subnet_prefix" {
  description = "VNet integration subnet address prefix."
  type        = string
  default     = "10.0.1.0/24"
}

variable "tags" {
  description = "Tags applied to all resources."
  type        = map(string)
  default     = {}
}
