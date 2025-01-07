variable "rosa_1_nlb" {
  type        = string
  description = "ARN of first ROSA NLB"
}

variable "rosa_2_nlb" {
  type        = string
  description = "ARN of second ROSA NLB"
}

variable "route53_zone" {
  type        = string
  description = "Route53 Zone ID of hosted zone for domain to global accelerator"
}

variable "rosa_1_weight" {
  type        = number
  description = "Weighting for traffic to ROSA 1"
  default     = 50
}

variable "rosa_2_weight" {
  type        = number
  description = "Weighting for traffic to ROSA 2"
  default     = 50
}
