terraform {
  required_providers {
    osdgoogle = {
      source = "terraform-redhat/osdgoogle"
    }
  }
}

# Set the OCM_TOKEN environment variable for authentication
provider "osdgoogle" {}
