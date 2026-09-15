variable "rosa_openshift_version" {
  type        = string
  default     = "4.22.12"
  description = "Desired version of OpenShift for the ROSA cluster."
}

variable "aro_openshift_version" {
  type        = string
  default     = "4.20.15"
  description = "Desired version of OpenShift for the ARO cluster."
}

variable "osd_openshift_version" {
  type        = string
  default     = "4.18.1"
  description = "Desired version of OpenShift for the OSD cluster."
}

variable "create_rosa" {
  type        = bool
  default     = false
  description = "Create a ROSA HCP cluster."
}

variable "create_aro" {
  type        = bool
  default     = false
  description = "Create an ARO cluster."
}

variable "create_osd" {
  type        = bool
  default     = false
  description = "Create an OSD cluster on GCP."
}

variable "create_vpc" {
  type        = bool
  default     = true
  description = "Create a new VPC for the ROSA cluster."
}

variable "subscription_id" {
  type        = string
  default     = ""
  description = "Azure Subscription ID. Required when create_aro is true."
}

variable "cluster_name" {
  type        = string
  default     = null
  description = "The name of the cluster to create."
}

variable "tags" {
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
  default     = false
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
  default     = "eu-west-2"
  description = "AWS region."
}

variable "default_aws_tags" {
  type        = map(string)
  default     = {}
  description = "Default tags for AWS resources."
}

variable "default_azure_tags" {
  type        = map(string)
  default     = {}
  description = "Default tags for Azure resources."
}

variable "deploy_virt_machine_pool" {
  type        = bool
  default     = false
  description = "Deploy a metal node to demo OpenShift Virtualization."
}

variable "deploy_graviton_machine_pool" {
  type        = bool
  default     = false
  description = "Deploy a Graviton node to demo ARM containers on OpenShift."
}

variable "deploy_lokistack_machine_pool" {
  type        = bool
  default     = false
  description = "Deploy additional nodes for OpenShift Logging with LokiStack."
}

variable "deploy_ai_machine_pool" {
  type        = bool
  default     = false
  description = "Deploy additional nodes for OpenShift AI."
}

variable "domain" {
  type        = string
  default     = ""
  description = "Domain for the ARO cluster. Required when create_aro is true."
}

variable "pull_secret_path" {
  type        = string
  default     = null
  description = "Path to a pull secret file for the cluster."
}

variable "gcp_project_id" {
  type        = string
  default     = ""
  description = "GCP project ID. Required when create_osd is true."
}

variable "osd_cloud_region" {
  type        = string
  default     = "us-central1"
  description = "GCP region for the OSD cluster."
}

variable "osd_compute_nodes" {
  type        = number
  default     = 3
  description = "Number of compute nodes for the OSD cluster."
}

variable "osd_compute_machine_type" {
  type        = string
  default     = "custom-4-16384"
  description = "GCP machine type for OSD compute nodes."
}
