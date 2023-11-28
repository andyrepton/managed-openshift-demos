#!/bin/bash

../../setup/check_command.sh terraform
../../setup/check_command.sh az

# Clone the repository
git clone https://github.com/rh-mobb/terraform_rhcs_rosa_sts.git
cd terraform_rhcs_rosa_sts/rosa_sts_managed_oidc || exit 1

# Prompt the user for input
read -p "Enter the cluster name: " cluster_name

# Run Terraform commands
terraform init -upgrade
terraform plan -var "cluster_name=$cluster_name"

read -p "Do you want to apply the changes? (y/n): " apply_response
if [[ $apply_response == "y" ]]; then
    terraform apply -var "cluster_name=$cluster_name"
else
    echo "Aborted. No changes applied."
fi

