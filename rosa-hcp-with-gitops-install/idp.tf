# Create an htpasswd IDP for the admin

resource "rhcs_identity_provider" "admin" {
  cluster = module.rosa-hcp.cluster_id

  name = var.admin_username
  htpasswd = {
    users = [{
      username = var.admin_username
      password = var.admin_password
    }]
  }
}

resource "rhcs_group_membership" "admin" {
  cluster = module.rosa-hcp.cluster_id

  user    = rhcs_identity_provider.admin.htpasswd.users[0].username
  group   = "cluster-admins"
}
