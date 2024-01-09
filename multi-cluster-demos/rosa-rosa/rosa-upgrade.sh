#!/bin/bash

# Function to choose cluster upgrade or rebuild
choose_action() {
  read -p "Choose action for $1 cluster (upgrade/rebuild): " action
  case $action in
    upgrade)
      read -p "Enter the OpenShift version (e.g., 4.14.0): " openshift_version
      terraform_apply_upgrade $1 "$openshift_version"
      ;;
    rebuild)
      read -p "Enter the OpenShift version (e.g., 4.14.0): " openshift_version
      terraform_destroy_and_apply $1 "$openshift_version"
      ;;
    *)
      echo "Invalid choice. Please choose 'upgrade' or 'rebuild'."
      choose_action $1
      ;;
  esac
}

get_other_cluster() {
  case $1 in
    blue)
      echo "green"
      ;;
    green)
      echo "blue"
      ;;
    *)
      echo "Invalid cluster choice."
      exit 1
      ;;
  esac
}

# Function to apply cluster upgrade
terraform_apply_upgrade() {
  choice_of_cluster=$1
  openshift_version=$2
  other_cluster=$(get_other_cluster $choice_of_cluster)
  terraform apply -target=module.rosa-cluster-${choice_of_cluster} -var="${choice_of_cluster}_rosa_openshift_version=${openshift_version}" -var="${other_cluster}_rosa_openshift_version=${openshift_version}"
}

# Function to destroy and then apply cluster (rebuild)
terraform_destroy_and_apply() {
  choice_of_cluster=$1
  openshift_version=$2
  other_cluster=$(get_other_cluster $choice_of_cluster)
  terraform destroy -target=module.rosa-cluster-${choice_of_cluster} -var="${choice_of_cluster}_rosa_openshift_version=${openshift_version}" -var="${other_cluster}_rosa_openshift_version=${openshift_version}"
  terraform apply -target=module.rosa-cluster-${choice_of_cluster} -var="${choice_of_cluster}_rosa_openshift_version=${openshift_version}" -var="${other_cluster}_rosa_openshift_version=${openshift_version}"
}

# Main script
read -p "Choose cluster to upgrade (blue/green): " choice_of_cluster

case $choice_of_cluster in
  blue | green)
    choose_action $choice_of_cluster
    ;;
  *)
    echo "Invalid choice. Please choose 'blue' or 'green'."
    ;;
esac

