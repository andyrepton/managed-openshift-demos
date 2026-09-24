variable "cluster_name" {
  description = "ARO HCP cluster name."
  type        = string
}

variable "location" {
  description = "Azure region for all resources."
  type        = string
  default     = "uksouth"
}

variable "cluster_version" {
  description = "OpenShift version for the HCP cluster (X.Y stream)."
  type        = string
  default     = "4.22"
}

variable "cluster_channel" {
  description = "OpenShift channel group for the cluster."
  type        = string
  default     = "stable"
}

variable "node_pool_version" {
  description = "OpenShift version (X.Y.Z) inherited by node_pools entries that omit version."
  type        = string
  default     = "4.22.9"
}

variable "node_pool_channel" {
  description = "OpenShift channel group inherited by node_pools entries that omit channel."
  type        = string
  default     = "stable"
}

variable "node_pools" {
  description = "HCP nodePools keyed by ARM name."
  type = map(object({
    vm_size                   = string
    replicas                  = optional(number, 2)
    min_replicas              = optional(number)
    max_replicas              = optional(number)
    version                   = optional(string)
    channel                   = optional(string)
    disk_size_gib             = optional(number)
    disk_storage_account_type = optional(string)
    disk_type                 = optional(string)
    disk_encryption_set       = optional(string)
    availability_zone         = optional(string)
    encryption_at_host        = optional(bool)
    subnet_id                 = optional(string)
    auto_repair               = optional(bool)
    node_drain_timeout        = optional(number)
    labels                    = optional(map(string), {})
    taints = optional(list(object({
      key    = string
      value  = string
      effect = string
    })), [])
    tags = optional(map(string), {})
  }))
  default = {
    np-1 = {
      vm_size           = "Standard_D4s_v6"
      replicas          = 2
      availability_zone = "1"
    }
  }
}

variable "api_visibility" {
  description = "Kube-apiserver visibility: Public or Private."
  type        = string
  default     = "Public"
}

variable "ingress_visibility" {
  description = "Default ingress visibility: Public, Private, or Disabled."
  type        = string
  default     = "Public"
}

variable "outbound_type" {
  description = "Cluster egress: LoadBalancer or UserDefinedRouting."
  type        = string
  default     = "LoadBalancer"
}

variable "vault_visibility" {
  description = "etcd KMS Key Vault visibility: Public or Private."
  type        = string
  default     = "Public"
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

variable "pod_cidr" {
  description = "Kubernetes pod CIDR."
  type        = string
  default     = "10.128.0.0/14"
}

variable "service_cidr" {
  description = "Kubernetes service CIDR."
  type        = string
  default     = "172.30.0.0/16"
}

variable "host_prefix" {
  description = "Host prefix for the cluster network."
  type        = number
  default     = 23
}

variable "enable_external_auth" {
  description = "Configure Entra ID external authentication for the console and CLI."
  type        = bool
  default     = true
}

variable "pull_secret_path" {
  description = "Path to a Red Hat dockerconfigjson pull secret. When set, stored in Key Vault."
  type        = string
  default     = ""
  validation {
    condition     = trimspace(var.pull_secret_path) == "" || fileexists(var.pull_secret_path)
    error_message = "pull_secret_path must be an existing file or empty."
  }
}

variable "tags" {
  description = "Tags applied to all resources."
  type        = map(string)
  default     = {}
}
