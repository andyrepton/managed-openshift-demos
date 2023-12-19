
resource "null_resource" "run_local_script" {
  provisioner "local-exec" {
    command = "bash ${path.module}/install-gitops.sh"
  }
}
