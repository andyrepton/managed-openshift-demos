variable "cluster_name" {
  type = string
  default = null
}

#AWS Info
variable "aws_region" {
  type    = string
  default = "us-east-2"
}

variable "admin_username" {
  type = string
  description = "The username for the admin user"
}

variable "admin_password" {
  type = string
  description = "The password for the admin user"
  sensitive = true
}

variable "custom_domain" {}
