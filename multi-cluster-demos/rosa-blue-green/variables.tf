variable "aws_region" {
  type        = string
  description = "AWS region for all clusters"
  default     = "eu-west-1"
}

variable "cluster_name_prefix" {
  type        = string
  description = "Prefix for all cluster and resource names"
}

variable "cluster_pairs" {
  type = map(object({
    blue_cidr                    = string
    green_cidr                   = string
    blue_version                 = string
    green_version                = string
    replicas                     = optional(number, 3)
    machine_type                 = optional(string, "m5.xlarge")
    private                      = optional(bool, false)
    upgrade_acknowledgements_for = optional(string, null)
    machine_pools = optional(map(object({
      name          = string
      instance_type = string
      replicas      = optional(number, null)
      autoscaling = optional(object({
        enabled      = bool
        min_replicas = number
        max_replicas = number
      }), null)
      labels      = optional(map(string), null)
      auto_repair = optional(bool, true)
      taints = optional(list(object({
        key           = string
        value         = string
        schedule_type = string
      })), null)
      subnet_index = optional(number, 0)
      aws_tags     = optional(map(string), {})
    })), {})
  }))
  description = "Map of cluster pair definitions. Each key is a pair name. blue_cidr and green_cidr set the VPC CIDR for each cluster (e.g. '10.0.0.0/24'). CIDRs must not overlap across pairs. machine_pools adds extra node pools to both blue and green clusters in the pair."
}

variable "irsa_roles" {
  type = map(object({
    cluster_key     = string
    role_name       = string
    namespace       = string
    service_account = string
    policy_arns     = list(string)
  }))
  default     = {}
  description = "Map of IRSA role definitions. cluster_key must match a flattened cluster key (e.g. 'production-blue')."
}

variable "default_aws_tags" {
  type        = map(string)
  default     = {}
  description = "Default tags applied to all AWS resources via the provider"
}

variable "tags" {
  type        = map(string)
  default     = {}
  description = "Additional resource tags"
}
