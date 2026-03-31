# Hard code to 1.7.4 for now, as there's a bug in 1.7.5
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 4.20.0"
    }
    rhcs = {
      version = "= 1.7.4"
      source  = "terraform-redhat/rhcs"
    }
  }
}

# Export token using the RHCS_TOKEN environment variable
provider "rhcs" {}

provider "aws" {
  region = "us-east-1"
  ignore_tags {
    key_prefixes = ["kubernetes.io/", "karpenter.sh/discovery"]
  }
  default_tags {
    tags = var.default_aws_tags
  }
}

data "aws_caller_identity" "current" {}
