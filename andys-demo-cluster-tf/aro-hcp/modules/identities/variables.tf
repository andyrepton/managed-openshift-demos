variable "cluster_name" {
  type = string
}

variable "resource_group_name" {
  type = string
}

variable "location" {
  type = string
}

variable "vnet_id" {
  type = string
}

variable "nsg_id" {
  type = string
}

variable "subnet_id" {
  type = string
}

variable "pull_secret_content" {
  description = "Red Hat dockerconfigjson pull secret content. When non-empty, stored in the customer Key Vault."
  type        = string
  default     = ""
  sensitive   = true
  validation {
    condition = (
      length(trimspace(var.pull_secret_content)) == 0 ||
      (
        can(jsondecode(var.pull_secret_content)) &&
        contains(keys(jsondecode(var.pull_secret_content)), "auths")
      )
    )
    error_message = "pull_secret_content must be empty or a dockerconfigjson object with an auths key."
  }
}

variable "pull_secret_key_vault_secret_name" {
  description = "Key Vault secret name for the pull secret."
  type        = string
  default     = "pull-secret"
  validation {
    condition     = can(regex("^[0-9a-zA-Z-]{1,127}$", var.pull_secret_key_vault_secret_name))
    error_message = "pull_secret_key_vault_secret_name must be 1-127 alphanumeric characters or hyphens."
  }
}

variable "tags" {
  type    = map(string)
  default = {}
}
