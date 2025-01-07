terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 4.20.0"
    }
    rhcs = {
      version = ">= 1.5.0"
      source  = "terraform-redhat/rhcs"
    }
  }
}

# Export token using the RHCS_TOKEN environment variable
provider "rhcs" {}

provider "aws" {
  alias  = "west"
  region = "eu-west-1"
  ignore_tags {
    key_prefixes = ["kubernetes.io/"]
  }
}

provider "aws" {
  alias  = "central"
  region = "eu-central-1"
  ignore_tags {
    key_prefixes = ["kubernetes.io/"]
  }
}

data "aws_caller_identity" "current" {}
