variable "cluster_name" {
  type        = string
  description = "Name of the ROSA HCP cluster"
}

variable "openshift_version" {
  type        = string
  description = "OpenShift version (e.g. 4.16.4). Changing triggers an upgrade."
}

variable "aws_subnet_ids" {
  type        = list(string)
  description = "Subnet IDs for the cluster"
}

variable "aws_availability_zones" {
  type        = list(string)
  description = "Availability zones for the cluster"
}

variable "replicas" {
  type        = number
  default     = 3
  description = "Number of worker replicas"
}

variable "compute_machine_type" {
  type        = string
  default     = "m5.xlarge"
  description = "EC2 instance type for worker nodes"
}

variable "private" {
  type        = bool
  default     = false
  description = "Whether the cluster API and routes are private"
}

variable "upgrade_acknowledgements_for" {
  type        = string
  default     = null
  description = "Minor version to acknowledge for upgrades (e.g. 4.17)"
}

variable "machine_pools" {
  type = map(object({
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
    subnet_id = string
    aws_tags  = optional(map(string), {})
  }))
  default     = {}
  description = "Additional machine pools to create on this cluster"
}

variable "tags" {
  type        = map(string)
  default     = {}
  description = "Tags to apply to cluster resources"
}
