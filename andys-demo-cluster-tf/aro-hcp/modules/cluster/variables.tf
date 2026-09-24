variable "cluster_name" {
  type = string
}

variable "resource_group_name" {
  type = string
}

variable "resource_group_id" {
  type = string
}

variable "location" {
  type = string
}

variable "managed_resource_group_name" {
  type     = string
  default  = null
  nullable = true
}

variable "address_prefix" {
  type = string
}

variable "worker_subnet_id" {
  type = string
}

variable "vnet_integration_subnet_id" {
  type = string
}

variable "nsg_id" {
  type = string
}

variable "key_vault_name" {
  type = string
}

variable "etcd_key_version" {
  type = string
}

variable "etcd_encryption_key_name" {
  type = string
}

variable "service_identity_id" {
  type = string
}

variable "control_plane_operators" {
  type = map(string)
}

variable "data_plane_operators" {
  type = map(string)
}

variable "cluster_identity_ids" {
  type = set(string)
}

variable "cluster_version" {
  type    = string
  default = "4.22"
}

variable "cluster_channel" {
  type    = string
  default = "stable"
}

variable "api_visibility" {
  type    = string
  default = "Public"
}

variable "ingress_visibility" {
  type    = string
  default = "Public"
}

variable "outbound_type" {
  type    = string
  default = "LoadBalancer"
}

variable "vault_visibility" {
  type    = string
  default = "Public"
}

variable "pod_cidr" {
  type    = string
  default = "10.128.0.0/14"
}

variable "service_cidr" {
  type    = string
  default = "172.30.0.0/16"
}

variable "host_prefix" {
  type    = number
  default = 23
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

variable "tags" {
  type    = map(string)
  default = {}
}
