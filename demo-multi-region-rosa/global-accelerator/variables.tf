variable "rosa_1_nlb" {
  type        = string
  description = "ARN of first ROSA NLB"
}

variable "rosa_2_nlb" {
  type        = string
  description = "ARN of second ROSA NLB"
}

variable "route53_zone" {
  type = string
  description = "Route53 Zone ID of hosted zone for domain to global accelerator"
}
