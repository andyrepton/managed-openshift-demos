output "role_arn" {
  value       = aws_iam_role.irsa.arn
  description = "ARN of the IRSA IAM role"
}

output "role_name" {
  value       = aws_iam_role.irsa.name
  description = "Name of the IRSA IAM role"
}
