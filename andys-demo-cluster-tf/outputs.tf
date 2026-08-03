output "rhoai_aws_iam_access_key" {
  value = var.create_rosa ? module.rosa[0].aws_iam_access_key : ""
}

output "rhoai_aws_iam_secret_key" {
  value = var.create_rosa ? module.rosa[0].aws_iam_secret_key : ""
  sensitive = true
}
