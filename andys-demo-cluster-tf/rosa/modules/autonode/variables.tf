variable "cluster_id" {
  type        = string
  description = "ID of the cluster"
}

variable "cluster_name" {
  type        = string
  description = "The name of the ROSA cluster, used to name the IAM role and policy"
}

variable "private_subnet_ids" {
  type        = list(string)
  description = "Private subnets AutoNode may launch nodes into"
}
