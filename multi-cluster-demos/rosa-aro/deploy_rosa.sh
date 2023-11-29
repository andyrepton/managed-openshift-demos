#!/bin/bash

../../setup/check_command.sh terraform
../../setup/check_command.sh aws

# Clone the repository
git clone https://github.com/rh-mobb/terraform_rhcs_rosa_sts.git
cd terraform_rhcs_rosa_sts/rosa_sts_managed_oidc || exit 1

# Set default values
DEFAULT_CLUSTER_NAME="poc-andyr"
DEFAULT_AWS_REGION="eu-west-1"

# Function to get availability zones for a given AWS region
function get_availability_zones() {
    local region=$1
    # Use AWS CLI to get availability zones for the specified region
    aws ec2 describe-availability-zones --region $region | jq -r '.AvailabilityZones[].ZoneName' | tr '\n' ' ' | sed 's/ $//'
}

# Function to check if a region is valid
function is_valid_region() {
    local region=$1
    # Validate AWS region using AWS CLI
    aws ec2 describe-regions --region $region &>/dev/null
}

# Prompt the user for input with default values and validate AWS_REGION
while true; do
    read -p "Enter cluster_name [default: $DEFAULT_CLUSTER_NAME]: " CLUSTER_NAME
    CLUSTER_NAME=${CLUSTER_NAME:-$DEFAULT_CLUSTER_NAME}

    read -p "Enter aws_region [default: $DEFAULT_AWS_REGION]: " AWS_REGION
    AWS_REGION=${AWS_REGION:-$DEFAULT_AWS_REGION}

    if is_valid_region "$AWS_REGION"; then
        break
    else
        echo "Invalid AWS region. Please enter a valid region."
    fi
done

# Automatically get availability zones based on the AWS region
AVAILABILITY_ZONES=$(get_availability_zones "$AWS_REGION")

# Display the entered or default values
echo "CLUSTER_NAME: $CLUSTER_NAME"
echo "AWS_REGION: $AWS_REGION"
echo "AVAILABILITY_ZONES: $AVAILABILITY_ZONES"

terraform init -upgrade

# Run Terraform command
terraform apply \
    -var "cluster_name=$CLUSTER_NAME" \
    -var "account_role_prefix=$CLUSTER_NAME" \
    -var "operator_role_prefix=$CLUSTER_NAME" \
    -var "aws_region=$AWS_REGION" \
    -var "availability_zones=$AVAILABILITY_ZONES" \
    -var "multi_az=true" \
    -var "create_vpc=true" \
    -var "enable_private_link=false"
