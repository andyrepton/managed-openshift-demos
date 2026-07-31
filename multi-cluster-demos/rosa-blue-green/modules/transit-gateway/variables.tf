variable "name" {
  type        = string
  description = "Name for the transit gateway"
}

variable "vpc_attachments" {
  type = map(object({
    vpc_id                  = string
    subnet_ids              = list(string)
    vpc_cidr                = string
    private_route_table_ids = list(string)
  }))
  description = "Map of VPCs to attach to the transit gateway"
}

variable "tags" {
  type        = map(string)
  default     = {}
  description = "Tags to apply to all resources"
}
