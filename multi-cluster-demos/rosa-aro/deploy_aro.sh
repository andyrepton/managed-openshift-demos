#!/bin/bash

../../setup/check_command.sh terraform
../../setup/check_command.sh az


# Set default values
DEFAULT_AZR_RESOURCE_LOCATION="westeurope"
DEFAULT_AZR_RESOURCE_GROUP="poc-andyr"
DEFAULT_AZR_CLUSTER="poc-andyr"
DEFAULT_AZR_PULL_SECRET="~/.secrets/pull-secret.txt"

# Function to check if a region is valid
function is_valid_region() {
    local region=$1
    # Use 'az' command to check if the region exists
    az account list-locations --query "[?name=='$region'].name" | grep -q "$region"
}

function check_aro_versions() {
    local region=$1
    az aro get-versions -l $region
}

# Prompt the user for input with default values and validate AZR_RESOURCE_LOCATION
while true; do
    read -p "Enter AZR_RESOURCE_LOCATION [default: $DEFAULT_AZR_RESOURCE_LOCATION]: " AZR_RESOURCE_LOCATION
    AZR_RESOURCE_LOCATION=${AZR_RESOURCE_LOCATION:-$DEFAULT_AZR_RESOURCE_LOCATION}

    if is_valid_region "$AZR_RESOURCE_LOCATION"; then
        break
    else
        echo "Invalid Azure region. Please enter a valid region."
    fi
done

function choose_aro_version() {
    local versions=($(az aro get-versions -l "$1" | jq -r '.[]'))

    echo "Available ARO versions:"
    for ((i=0; i<${#versions[@]}; i++)); do
        echo "$(($i + 1)). ${versions[$i]}"
    done

    local choice
    while true; do
        read -p "Choose a version (1-${#versions[@]}): " choice
        if [[ "$choice" =~ ^[0-9]+$ ]] && ((choice >= 1 && choice <= ${#versions[@]})); then
            break
        else
            echo "Invalid choice. Please enter a number between 1 and ${#versions[@]}."
        fi
    done

    AZR_VERSION=${versions[$(($choice - 1))]}
    echo "Selected ARO version: $AZR_VERSION"
}

read -p "Enter AZR_RESOURCE_GROUP [default: $DEFAULT_AZR_RESOURCE_GROUP]: " AZR_RESOURCE_GROUP
AZR_RESOURCE_GROUP=${AZR_RESOURCE_GROUP:-$DEFAULT_AZR_RESOURCE_GROUP}

read -p "Enter AZR_CLUSTER [default: $DEFAULT_AZR_CLUSTER]: " AZR_CLUSTER
AZR_CLUSTER=${AZR_CLUSTER:-$DEFAULT_AZR_CLUSTER}

read -p "Enter AZR_PULL_SECRET [default: $DEFAULT_AZR_PULL_SECRET]: " AZR_PULL_SECRET
AZR_PULL_SECRET=${AZR_PULL_SECRET:-$DEFAULT_AZR_PULL_SECRET}

choose_aro_version "$AZR_RESOURCE_LOCATION"

az group create \
  --name $AZR_RESOURCE_GROUP \
  --location $AZR_RESOURCE_LOCATION

az network vnet create \
  --address-prefixes 10.0.0.0/22 \
  --name "$AZR_CLUSTER-aro-vnet-$AZR_RESOURCE_LOCATION" \
  --resource-group $AZR_RESOURCE_GROUP

az network vnet subnet create \
  --resource-group $AZR_RESOURCE_GROUP \
  --vnet-name "$AZR_CLUSTER-aro-vnet-$AZR_RESOURCE_LOCATION" \
  --name "$AZR_CLUSTER-aro-control-subnet-$AZR_RESOURCE_LOCATION" \
  --address-prefixes 10.0.0.0/23

az network vnet subnet create \
  --resource-group $AZR_RESOURCE_GROUP \
  --vnet-name "$AZR_CLUSTER-aro-vnet-$AZR_RESOURCE_LOCATION" \
  --name "$AZR_CLUSTER-aro-machine-subnet-$AZR_RESOURCE_LOCATION" \
  --address-prefixes 10.0.2.0/23

az network vnet subnet update \
  --name "$AZR_CLUSTER-aro-control-subnet-$AZR_RESOURCE_LOCATION" \
  --resource-group $AZR_RESOURCE_GROUP \
  --vnet-name "$AZR_CLUSTER-aro-vnet-$AZR_RESOURCE_LOCATION" \
  --disable-private-link-service-network-policies true

az aro create \
  --resource-group $AZR_RESOURCE_GROUP \
  --name $AZR_CLUSTER \
  --vnet "$AZR_CLUSTER-aro-vnet-$AZR_RESOURCE_LOCATION" \
  --master-subnet "$AZR_CLUSTER-aro-control-subnet-$AZR_RESOURCE_LOCATION" \
  --worker-subnet "$AZR_CLUSTER-aro-machine-subnet-$AZR_RESOURCE_LOCATION" \
  --pull-secret @$AZR_PULL_SECRET \
  --version "$AZR_VERSION"

ARO_URL=$(az aro show --name $AZR_CLUSTER --resource-group $AZR_RESOURCE_GROUP -o tsv --query consoleProfile)
read -r ARO_ADMIN_PASSWORD ARO_ADMIN_USERNAME <<< $(az aro list-credentials --name $AZR_CLUSTER --resource-group $AZR_RESOURCE_GROUP -o tsv)
