variable "vpc_name" {
  type        = string
  description = "Name for the VPC"
}

variable "vpc_cidr" {
  type        = string
  description = "CIDR block for the VPC (e.g. '10.0.0.0/24')"
}

variable "azs" {
  type        = list(string)
  description = "List of 3 availability zones"
}

variable "single_nat_gateway" {
  type        = bool
  default     = true
  description = "Use a single NAT gateway instead of one per AZ (cost saving)"
}

variable "tags" {
  type        = map(string)
  default     = {}
  description = "Tags to apply to all resources"
}
