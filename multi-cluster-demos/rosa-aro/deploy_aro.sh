#!/bin/bash

../../setup/check_command.sh terraform
../../setup/check_command.sh az

# Function to get the current Azure subscription ID
get_subscription_id() {
    az account show --query id --output tsv
}

subscription_id=$(get_subscription_id)

if [ -z "$subscription_id" ]; then
    echo "Unable to determine Azure subscription ID from 'az' command."
    read -p "Enter the subscription ID: " subscription_id
fi

# Clone the repository
git clone https://github.com/rh-mobb/terraform-aro.git
cd terraform-aro || exit 1

# Prompt the user for input
read -p "Enter the cluster name: " cluster_name

# Run Terraform commands
terraform init -upgrade
terraform plan -var "cluster_name=$cluster_name" -var "subscription_id=$subscription_id"

read -p "Do you want to apply the changes? (y/n): " apply_response
if [[ $apply_response == "y" ]]; then
    terraform apply -var "cluster_name=$cluster_name"
else
    echo "Aborted. No changes applied."
fi

