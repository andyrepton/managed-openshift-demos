terraform {
  required_version = ">= 1.5.7"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.38.0"
    }
    rhcs = {
      source  = "terraform-redhat/rhcs"
      version = ">= 1.7.7"
    }
  }
}

provider "rhcs" {}

provider "aws" {
  region = var.aws_region

  ignore_tags {
    key_prefixes = ["kubernetes.io/"]
  }

  default_tags {
    tags = var.default_aws_tags
  }
}
