# Pull in the data source from our cluster build, setting an explict depends_on to ensure the cluster install has finished
data "rhcs_cluster_rosa_hcp" "cluster" {
  id = module.rosa-hcp.cluster_id
  depends_on = [module.rosa-hcp, rhcs_group_membership.gitops]
}

# Generate a random password for the gitops user. Depend on the sleeps_on below to not initialise the kubernetes or kubectl providers until the idp is set up
resource "random_password" "password" {
  length           = 32
  special          = true

  #depends_on = [time_sleep.wait_60_seconds]
}

# Create a dedicated user just for gitops to login. Don't save the password anywhere outside the TF state
resource "rhcs_identity_provider" "gitops" {
  cluster = module.rosa-hcp.cluster_id

  name = "gitops-user"
  htpasswd = {
    users = [{
      username = "gitops-users"
      password = random_password.password.result
    }]
  }
}

resource "rhcs_group_membership" "gitops" {
  cluster = module.rosa-hcp.cluster_id

  user    = rhcs_identity_provider.gitops.htpasswd.users[0].username
  group   = "cluster-admins"
}

# When adding a new idp, the cluster auth pods will restart. This takes some time and if we connect too quickly we'll get a permission denied
#resource "time_sleep" "wait_60_seconds" {
#  depends_on = [module.rosa-hcp]
#  create_duration = "60s"
#}

# Create a fake client.authentication.k8s.io/v1beta1 entry to pass to the providers with the credentials we've just created
# This is so we can use the exec option to Kubectl to force a load of credentials half way through a terraform run
# See https://kubernetes.io/docs/reference/access-authn-authz/authentication/#input-and-output-formats for more details



# To-Do: have rosa output this info similar to how the aws eks command does.

resource "local_sensitive_file" "login_file" {
  content = <<JSON
{
  "kind": "ExecCredential",
  "apiVersion": "client.authentication.k8s.io/v1beta1",
  "status": {
    "token": "sha256~0kMPE1nJ8FK2KANBKdTvKPhdQPWhqOF98RC2wBXxpKw"
  }
}
JSON

  filename = "${path.module}/login.config"
}

# Setup Kubernetes provider
provider "kubernetes" {
  host = data.rhcs_cluster_rosa_hcp.cluster.api_url
  username = rhcs_identity_provider.admin.htpasswd.users[0].username
  password = random_password.password.result
}

#Setup Kubectl provider - needed because the kubernetes provider uses server-side-apply for CRDs (which the operator is)
provider "kubectl" {
  host = data.rhcs_cluster_rosa_hcp.cluster.api_url
  username = rhcs_identity_provider.admin.htpasswd.users[0].username
  password = random_password.password.result
}

# Create the project for gitops
resource "kubernetes_namespace" "openshift-gitops" {
  metadata {
    name = "openshift-gitops"
  }
  depends_on = [module.rosa-hcp, rhcs_group_membership.gitops]
}

# Create the RBAC ClusterRoleBinding for gitops
resource "kubernetes_cluster_role_binding" "gitops" {
  metadata {
    name = "gitops-cluster-admin-binding"
  }
  role_ref {
    api_group = "rbac.authorization.k8s.io"
    kind      = "ClusterRole"
    name      = "cluster-admin"
  }
  subject {
    kind      = "ServiceAccount"
    name      = "openshift-gitops-argocd-application-controller"
    namespace = "openshift-gitops"
  }
  depends_on = [module.rosa-hcp, rhcs_group_membership.gitops]
}

# Install the GitOps Operator
resource "kubectl_manifest" "gitops-operator" {
  yaml_body = <<YAML
apiVersion: operators.coreos.com/v1alpha1
kind: Subscription
metadata:
  name: openshift-gitops-operator
  namespace: openshift-operators
spec:
  channel: latest 
  installPlanApproval: Automatic
  name: openshift-gitops-operator 
  source: redhat-operators 
  sourceNamespace: openshift-marketplace 
YAML

  depends_on = [module.rosa-hcp, rhcs_group_membership.gitops]
}
