#!/bin/bash

# Access the passed variables as $1 and $2
admin_username=$1
admin_password=$2


api_url=$3

while True
do
	response=$(oc login $api_url --username $admin_username --password $admin_password)
	if [[ $response =~ "Login successful." ]]; then
		break 
	else
		sleep 60
	fi 
done

echo "Installing GitOps"
oc apply -f https://raw.githubusercontent.com/andyrepton/managed-openshift-demos/main/openshift-gitops/gitops-install.yaml


# Set edge reencrypt
oc -n openshift-gitops patch argocd/openshift-gitops --type=merge -p='{"spec":{"server":{"route":{"enabled":true,"tls":{"insecureEdgeTerminationPolicy":"Redirect","termination":"reencrypt"}}}}}'
