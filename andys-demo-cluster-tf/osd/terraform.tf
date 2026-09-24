terraform {
  required_providers {
    osdgoogle = {
      source  = "rh-mobb/osd-google"
      version = ">= 0.0.1"
    }
    google = {
      source  = "hashicorp/google"
      version = ">= 5.0"
    }
  }
}
