variable "cluster_name" {
  type        = string
  description = "Name of the ROSA cluster, used to name the BGP resources."
}

variable "cluster_id" {
  type        = string
  description = "ID of the ROSA cluster, used to look up the OIDC issuer."
}

variable "vpc_id" {
  type        = string
  description = "VPC the Route Server is associated with."
}

variable "private_subnets" {
  type        = list(string)
  description = "Private subnets to place a Route Server endpoint in, one each."
}

variable "private_route_table_ids" {
  type        = list(string)
  description = "Private route tables to propagate advertised routes into."
}

variable "public_route_table_ids" {
  type        = list(string)
  description = "Public route tables to propagate advertised routes into."
}

variable "route_server_asn" {
  type        = string
  default     = "65000"
  description = "ASN for the AWS VPC Route Server."
}

variable "operator_namespace" {
  type        = string
  default     = "openshift-bgp-cloud-connector"
  description = "Namespace for the bgp-cloud-connector operator."
}

variable "operator_service_account" {
  type        = string
  default     = "openshift-bgp-cloud-connector-controller-manager"
  description = "Service account for the bgp-cloud-connector operator."
}
