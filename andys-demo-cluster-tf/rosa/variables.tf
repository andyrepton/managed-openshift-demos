variable "openshift_version" {
  type        = string
  default     = "4.22.12"
  description = "Desired version of OpenShift for the cluster."
}

variable "create_vpc" {
  type        = bool
  description = "Create a new VPC for the ROSA cluster."
}

variable "cluster_name" {
  type        = string
  default     = null
  description = "The name of the ROSA cluster to create."
}

variable "additional_tags" {
  type        = map(string)
  default     = {}
  description = "Additional AWS resource tags."
}

variable "multi_az" {
  type        = bool
  default     = true
  description = "Multi AZ cluster for high availability."
}

variable "path" {
  type        = string
  default     = null
  description = "(Optional) The ARN path for the account/operator roles and their policies."
}

variable "machine_type" {
  type        = string
  default     = "m5.xlarge"
  description = "The AWS instance type for the default worker pool."
}

variable "worker_node_replicas" {
  type        = number
  default     = 3
  description = "Number of worker nodes. Single zone clusters need at least 2, multizone need at least 3."
}

variable "autoscaling_enabled" {
  type        = bool
  default     = false
  description = "Enable autoscaling. Requires min_replicas and max_replicas."
}

variable "min_replicas" {
  type        = number
  default     = 3
  description = "Minimum number of replicas for autoscaling."
}

variable "max_replicas" {
  type        = number
  default     = 3
  description = "Maximum number of replicas for autoscaling."
}

variable "proxy" {
  type = object({
    http_proxy              = string
    https_proxy             = string
    additional_trust_bundle = optional(string)
    no_proxy                = optional(string)
  })
  default     = null
  description = "Cluster-wide HTTP or HTTPS proxy settings."
}

variable "aws_subnet_ids" {
  type        = list(string)
  default     = []
  description = "Subnet IDs to use when create_vpc is false."
}

variable "private_cluster" {
  type        = bool
  description = "Make the cluster private."
}

variable "vpc_name" {
  type        = string
  default     = "poc-andyr-vpc"
  description = "VPC name."
}

variable "vpc_cidr_block" {
  type        = string
  default     = "10.0.0.0/16"
  description = "CIDR block for the VPC."
}

variable "private_subnet_cidrs" {
  type        = list(string)
  default     = ["10.0.1.0/24", "10.0.2.0/24", "10.0.3.0/24"]
  description = "CIDR blocks for private subnets."
}

variable "public_subnet_cidrs" {
  type        = list(string)
  default     = ["10.0.101.0/24", "10.0.102.0/24", "10.0.103.0/24"]
  description = "CIDR blocks for public subnets."
}

variable "single_nat_gateway" {
  type        = bool
  default     = false
  description = "Use a single NAT gateway instead of one per subnet."
}

variable "aws_region" {
  type        = string
  default     = "us-east-2"
  description = "AWS region."
}

variable "default_aws_tags" {
  type        = map(string)
  default     = {}
  description = "Default tags for AWS resources."
}

variable "deploy_virt_machine_pool" {
  type        = bool
  description = "Deploy a metal node to demo OpenShift Virtualization."
}

variable "deploy_graviton_machine_pool" {
  type        = bool
  description = "Deploy a Graviton node to demo ARM containers on OpenShift."
}

variable "deploy_lokistack_machine_pool" {
  type        = bool
  description = "Deploy additional nodes for OpenShift Logging with LokiStack."
}

variable "deploy_ai_machine_pool" {
  type        = bool
  description = "Deploy additional nodes for OpenShift AI."
}

variable "properties" {
  type        = map(string)
  default     = {}
  description = "Extra properties for ROSA."
}
