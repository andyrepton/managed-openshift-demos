#!/bin/bash

set -e

# IMPROVEMENTS/To-Do:
# - Dynamically check if commands are installed
# - Create a install_all_demos function
# - Create a clean_all_demos function

# Ideas for more demos:
# - Ruby app - Source2Image
# - Red Hat OpenShift Dev Spaces
# - ImageStreams - Security focus
# - RHACS
# - Dev Spaces - Build an App/Change it/Deploy to Dev namespace, then push and watch it build via Ci/Cd and go to Prod
# - Builds/Build Configs
# - Tekton pipelines
# - OpenShift GitOps
# - EFS installation
# - ServiceMesh
# - Submariner

# This script is designed to take a built, existing ROSA cluster and prepare it for demos to give to customers. This script expects that you have the following commands installed
# aws cli, rosa, oc, helm

help () {
  echo ""
  echo "This is a script designed to install and prep demos for customers on ROSA. Usage: "
  echo " ./create_demo.sh install_demo1"
  echo "Replace demo1 with demo2..99 as they are available."
  echo "When finished, run with clean_demoX where X is the demo you wish to clean from the cluster. E.G: "
  echo " ./create_demo.sh clean_demo1"
  exit 1
}

get_oidc_provider () {
  # HCP clusters do not have the `authentication.config.openshift.io cluster` CR, so this simply checks if it can get that, and if not falls back onto the rosa command to get it.
  echo "Checking OIDC Provider"
  export OIDC_PROVIDER=$(oc get authentication.config.openshift.io cluster -o json | jq -r .spec.serviceAccountIssuer| sed -e "s/^https:\/\///")
  if  [[ -n "${OIDC_PROVIDER}" ]]; then
    echo "Cluster appears to be HCP, getting OIDC provider from rosa command instead of oc command"
    export OIDC_PROVIDER=$(rosa describe cluster -c ${CLUSTER} -o json | jq -r '.aws.sts.oidc_config.issuer_url' | sed  's|^https://||')
  fi
}

check_cli () {
  required_cmds=("oc" "sed" "aws" "rosa")

  echo "Check all command tolls are installed"
  for cmd in "${required_cmds[@]}"
  do
    if ! command -v $cmd &> /dev/null
    then
      echo "Please install $cmd to continue"
      exit
    fi
  done
}

cluster_details () {
  read -p "Enter the cluster name: " CLUSTER

  read -p "Enter the AWS Region name: " AWS_REGION

  export CLUSTER
  export AWS_REGION
}

prep_demo1 () {
  cluster_details
  export NAMESPACE=ack-system
  export IAM_USER=${CLUSTER}-ack-controller
  # you can find the recommended policy in each projects github repo, example https://github.com/aws-controllers-k8s/s3-controller/blob/main/config/iam/recommended-policy-arn
  export S3_POLICY_ARN=arn:aws:iam::aws:policy/AmazonS3FullAccess
  export SCRATCH_DIR=/tmp/ack
  export ACK_SERVICE=s3
  export AWS_PAGER=""
  mkdir -p $SCRATCH_DIR
}

install_demo1 () {
  prep_demo1

  echo "Cleaning up demo1 before installing demo1"
  clean_demo1

  echo "Creating user $IAM_USER"
  aws iam create-user --user-name $IAM_USER
  aws iam attach-user-policy --user-name $IAM_USER --policy-arn $S3_POLICY_ARN

  read -r ACCESS_KEY_ID ACCESS_KEY < <(aws iam create-access-key \
    --user-name $IAM_USER \
    --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text)

  cat <<EOF > $SCRATCH_DIR/secrets.txt
AWS_ACCESS_KEY_ID=$ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY=$ACCESS_KEY
EOF

  cat <<EOF > $SCRATCH_DIR/config.txt
ACK_ENABLE_DEVELOPMENT_LOGGING=true
ACK_LOG_LEVEL=debug
ACK_WATCH_NAMESPACE=
AWS_ENDPOINT_URL=
AWS_REGION=$AWS_REGION
ACK_RESOURCE_TAGS=$CLUSTER
EOF

  oc new-project $NAMESPACE

  oc create configmap --namespace $NAMESPACE \
    --from-env-file=$SCRATCH_DIR/config.txt ack-s3-user-config

  oc create secret generic --namespace $NAMESPACE \
    --from-env-file=$SCRATCH_DIR/secrets.txt ack-s3-user-secrets

  echo "Demo 1 is ready to go. Please proceed to demo-1.md for your demo!"
}

clean_demo1 () {
  prep_demo1

  set +e
  echo "Checking if user $IAM_USER exists"
  USER_CHECK=$(aws iam list-users | grep $IAM_USER)
  echo $USER_CHECK
  set -e
  if [ -n "${USER_CHECK}" ]; then 
    echo "Checking if user policies are attached to $IAM_USER"
    USER_POLICIES=$(aws iam list-user-policies --user-name $IAM_USER | jq -r '.PolicyNames[]')
    ATTACHED_USER_POLICIES=$(aws iam list-attached-user-policies --user-name $IAM_USER | jq -r '.AttachedPolicies[]')
    if [ -n "${USER_POLICIES}" ]; then 
      echo "Detaching user policy from $IAM_USER"
      aws iam detach-user-policy --user-name $IAM_USER --policy-arn $S3_POLICY_ARN
    fi

    if [ -n "${ATTACHED_USER_POLICIES}" ]; then 
      echo "Detaching attached user policy from $IAM_USER"
      aws iam detach-user-policy --user-name $IAM_USER --policy-arn $S3_POLICY_ARN
    fi

    echo "Deleting access keys associated with user $IAM_USER"
    for ACCESS_KEY in $(aws iam list-access-keys --user-name $IAM_USER | jq -r '.AccessKeyMetadata[].AccessKeyId'); do
      aws iam delete-access-key --user-name $IAM_USER --access-key-id $ACCESS_KEY
    done

    echo "Removing $IAM_USER"
    aws iam delete-user --user-name $IAM_USER
  fi

  echo "Cleaning up project ack-system"
  oc projects | grep ack-system && oc delete project ack-system
  
  echo "Demo 1 is cleaned up"
}

prep_demo2 () {
  cluster_details
  export NAMESPACE=amazon-cloudwatch
  export IAM_USER=${CLUSTER}-cloud-watch
  export CW_POLICY_ARN=arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy
  export SCRATCH_DIR=/tmp/cloud-watch-metrics
  export AWS_PAGER=""
  mkdir -p $SCRATCH_DIR
}

install_demo2 () {
  prep_demo2

  echo "Cleaning up demo2 before installing demo2"
  clean_demo2

  echo "Creating blank dashboard"
  aws cloudwatch put-dashboard --dashboard-name ${CLUSTER}-Demo-Dash --dashboard-body file://demo2/basic-dash.json

  echo "Creating user $IAM_USER"
  aws iam create-user --user-name $IAM_USER > $SCRATCH_DIR/aws-user.json
  aws iam create-access-key --user-name $IAM_USER > $SCRATCH_DIR/aws-access-key.json
  aws iam attach-user-policy --user-name $IAM_USER --policy-arn $CW_POLICY_ARN

  AWS_ID=$(cat $SCRATCH_DIR/aws-access-key.json | jq -r '.AccessKey.AccessKeyId')
  AWS_KEY=$(cat $SCRATCH_DIR/aws-access-key.json | jq -r '.AccessKey.SecretAccessKey')

  echo "Creating project $NAMESPACE"
  oc new-project $NAMESPACE

  echo "Preparing cloud-watch agent config"
  cp setup/assets/cloud-watch.yaml $SCRATCH_DIR/cloud-watch.yaml

  sed -i .bak "s/__cluster_name__/$CLUSTER/g" $SCRATCH_DIR/cloud-watch.yaml
  sed -i .bak "s/__cluster_region__/$AWS_REGION/g" $SCRATCH_DIR/cloud-watch.yaml

  cp $SCRATCH_DIR/cloud-watch.yaml ./demo2/

  echo "Setting up credentials for Cloud Watch access"
  cat <<EOF > $SCRATCH_DIR/credentials
[AmazonCloudWatchAgent]
aws_access_key_id = $AWS_ID
aws_secret_access_key = $AWS_KEY
EOF

  oc --namespace $NAMESPACE \
    create secret generic aws-credentials \
    --from-file=credentials=$SCRATCH_DIR/credentials

  echo "Editing scc policy for cloudwatch agent"
  oc -n $NAMESPACE adm policy \
    add-scc-to-user anyuid -z cwagent-prometheus

  echo "Making custom dashboard json for demo2"
  cp setup/assets/dashboard.json $SCRATCH_DIR/dashboard.json

  sed -i .bak "s/__CLUSTER_NAME__/$CLUSTER/g" $SCRATCH_DIR/dashboard.json
  sed -i .bak "s/__REGION_NAME__/$AWS_REGION/g" $SCRATCH_DIR/dashboard.json

  cp $SCRATCH_DIR/dashboard.json demo2/

  echo "Demo2 is ready. Please proceed to demo-2.md for your demo commands!"
  echo "Your dashboard can be found at: https://${AWS_REGION}.console.aws.amazon.com/cloudwatch/home?region=${AWS_REGION}#dashboards:name=${CLUSTER}-Demo-Dash;start=PT5M"
}

clean_demo2 () {
  prep_demo2

  set +e
  echo "Checking if user $IAM_USER exists"
  USER_CHECK=$(aws iam list-users | grep $IAM_USER)
  echo $USER_CHECK
  set -e
  if [ -n "${USER_CHECK}" ]; then 
    echo "Checking if user policies are attached to $IAM_USER"
    USER_POLICIES=$(aws iam list-user-policies --user-name $IAM_USER | jq -r '.PolicyNames[]')
    ATTACHED_USER_POLICIES=$(aws iam list-attached-user-policies --user-name $IAM_USER | jq -r '.AttachedPolicies[]')
    if [ -n "${USER_POLICIES}" ]; then 
      echo "Detaching user policy from $IAM_USER"
      aws iam detach-user-policy --user-name $IAM_USER --policy-arn $CW_POLICY_ARN
    fi

    if [ -n "${ATTACHED_USER_POLICIES}" ]; then 
      echo "Detaching attached user policy from $IAM_USER"
      aws iam detach-user-policy --user-name $IAM_USER --policy-arn $CW_POLICY_ARN
    fi

    echo "Deleting access keys associated with user $IAM_USER"
    for ACCESS_KEY in $(aws iam list-access-keys --user-name $IAM_USER | jq -r '.AccessKeyMetadata[].AccessKeyId'); do
      aws iam delete-access-key --user-name $IAM_USER --access-key-id $ACCESS_KEY
    done

    echo "Removing $IAM_USER"
    aws iam delete-user --user-name $IAM_USER
  fi

  echo "Removing dashboard"
  aws cloudwatch delete-dashboards --dashboard-names $CLUSTER-Demo-Dash

  echo "Cleaning up project $NAMESPACE"
  oc projects | grep $NAMESPACE && oc delete project $NAMESPACE
  # Give the project a moment to be cleaned up
  sleep 5
  
  echo "Demo 2 is cleaned up"
}

prep_demo3 () {
  cluster_details
  export NAMESPACE=openshift-logging
  export POLICY_ARN_NAME=RosaCloudWatch
  export SCRATCH_DIR=/tmp/cloudwatch-logging
  export AWS_PAGER=""
  mkdir -p $SCRATCH_DIR
}

install_demo3 () {
  prep_demo3

  echo "Cleaning up demo3 before installing demo3"
  clean_demo3

  if rosa list machinepools -c ${CLUSTER} | grep logging-pool; then
    echo "Machine Pool already here. Leaving it be"
  else
    echo "WARNING: This demo requires the installation of the cluster logging operator. So, we need to add a new machinepool of 3 m5.2xlarge machines for this. This is going to take some time!"
    rosa create machinepool --cluster=${CLUSTER} --name=logging-pool --replicas=3 --instance-type=m5.2xlarge
  fi
  until rosa list machinepools -c ${CLUSTER} | grep logging-pool | awk '{print $4}' | grep 3
    do sleep 2 
  done

  echo "Checking for IAM policy RosaCloudWatch"
  POLICY_ARN=$(aws iam list-policies --query "Policies[?PolicyName=='RosaCloudWatch'].{ARN:Arn}" --output text)
  if [[ -z "${POLICY_ARN}" ]]; then
    cat << EOF > ${SCRATCH}/policy.json
{
"Version": "2012-10-17",
"Statement": [
   {
         "Effect": "Allow",
         "Action": [
            "logs:CreateLogGroup",
            "logs:CreateLogStream",
            "logs:DescribeLogGroups",
            "logs:DescribeLogStreams",
            "logs:PutLogEvents",
            "logs:PutRetentionPolicy"
         ],
         "Resource": "arn:aws:logs:*:*:*"
   }
]
}
EOF

    echo "Creating policy RosaCloudWatch"
    POLICY_ARN=$(aws iam create-policy --policy-name "RosaCloudWatch" \
      --policy-document file:///${SCRATCH}/policy.json --query Policy.Arn --output text)
  fi
  echo ${POLICY_ARN}

  get_oidc_provider

  export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

  cat <<EOF > ./demo3/TrustPolicy.json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::${AWS_ACCOUNT_ID}:oidc-provider/${OIDC_PROVIDER}"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "${OIDC_PROVIDER}:sub": [
            "system:serviceaccount:openshift-logging:logcollector"
          ]
        }
      }
    }
  ]
}
EOF

  echo "Creating IAM Role ${CLUSTER}-log-forward"
  ROLE_ARN=$(aws iam create-role --role-name "${CLUSTER}-log-forward" --assume-role-policy-document file://./demo3/TrustPolicy.json --query "Role.Arn" --output text)

  echo "Attaching role policy to ${CLUSTER}-log-forward"
  aws iam attach-role-policy --role-name "${CLUSTER}-log-forward" --policy-arn ${POLICY_ARN}

  echo "Installing ElasticSearch Operator"
  oc apply -f demo3/eo-namespace.yaml
  oc apply -f demo3/eo-og.yaml
  oc apply -f demo3/eo-sub.yaml
  echo "Installing Cluster Logging Operator"
  oc apply -f demo3/olo-namespace.yaml
  oc apply -f demo3/openshift-logging-og.yaml
  oc apply -f demo3/cluster-logging-sub.yaml

  until oc get ClusterLogging; do
    echo "Waiting 3 seconds for the Operators to install and prepare the CRDs"
    sleep 3
  done

  echo "Installing Cluster Logging"
  oc apply -f demo3/logging.yaml

  echo "Creating STS secret for LogForwarder"
  oc create secret generic cw-sts-secret -n openshift-logging --from-literal=role_arn=${ROLE_ARN}

  echo "Demo 3 is ready. Proceed to demo-3.md for your demo!"
}

hard_clean_demo3 () {
  # Since the introduction of HCP, there isn't a clean way to check if the machine pool is still in deleting mode. So made this separate check for now while I think of a more elegant way to achieve this
  prep_demo3
  clean_demo3
  rosa delete machinepool logging-pool -c ${CLUSTER} --yes
}

clean_demo3 () {
  prep_demo3

  echo "Removing secret"
  oc delete secret cw-sts-secret -n openshift-logging || echo "Secret not installed"

  echo "Removing clusterlogforwarder"
  oc delete clusterlogforwarder instance -n openshift-logging || echo "Cluster Log Forwarder already removed"

  echo "Removing clusterlogging"
  oc delete clusterlogging instance -n openshift-logging || echo "Cluster Logging already removed"

  echo "Removing OpenShift Cluster Logging"
  oc delete subscription cluster-logging -n openshift-logging || echo "Subscription already removed"
  oc delete operatorgroup openshift-logging || echo "OperatorGroup already removed"
  oc delete operator cluster-logging.openshift-logging || echo "Operator already removed"
  oc delete csv $(oc get csv -n openshift-logging | grep cluster-logging | awk '{print $1}') || echo "CSV already removed"

  echo "Removing ElasticSearch Operator"
  oc delete subscription elasticsearch-operator -n openshift-operators-redhat || echo "Subscription already removed"
  oc delete operatorgroup openshift-operators-redhat -n openshift-operators-redhat || echo "Operator Group already removed"
  oc delete operator elasticsearch-operator.openshift-operators-redhat || echo "Operator already removed"
  oc delete csv $(oc get csv -n openshift-operators-redhat | grep elasticsearch-operator | awk '{print $1}') || echo "CSV already removed"

  set +e
  echo "Checking if role ${CLUSTER}-log-forward exists"
  ROLE_CHECK=$(aws iam list-roles | grep ${CLUSTER}-log-forward)
  echo $ROLE_CHECK
  set -e
  if [ -n "${ROLE_CHECK}" ]; then
    POLICY_ARN=$(aws iam list-policies --query "Policies[?PolicyName=='RosaCloudWatch'].{ARN:Arn}" --output text)
    echo "Removing role policy ${CLUSTER}-log-forward from ${POLICY_ARN}"
    aws iam detach-role-policy --role-name "${CLUSTER}-log-forward" --policy-arn ${POLICY_ARN}

    echo "Removing role ${CLUSTER}-log-forward"
    aws iam delete-role --role-name "${CLUSTER}-log-forward"
  fi

  echo "Checking if machinepool is still here"
  if rosa list machinepools -c ${CLUSTER} | grep logging-pool; then
    echo "Machine Pool still here. Leaving it be"
  else
    echo "Machine Pool already cleaned up"
  fi

  echo "Cleaning up log groups"
  aws logs delete-log-group --log-group-name "${CLUSTER}.audit" || echo "AWS Log group ${CLUSTER}.audit does not exist"
  aws logs delete-log-group --log-group-name "${CLUSTER}.infrastructure" || echo "AWS log group ${CLUSTER}.infrastructure does not exist"

  echo "Demo 3 is cleaned up"
  echo "IMPORTANT: Logging Pool has been left behind, as the 'oc get machines' command does not work with HCP. Re-run with ./create_demo hard_clean_demo3 to clean this up fully"
}

prep_demo4 () {
  cluster_details
  export NAMESPACE=csi-secrets-store
  export SCRATCH_DIR=/tmp/aws-secrets-manager-csi
  export AWS_PAGER=""
  mkdir -p $SCRATCH_DIR
}

install_demo4 () {
  prep_demo4
  echo "Cleaning up demo4 before install"
  clean_demo4

  export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

  oc new-project ${NAMESPACE}
  echo "Creating project for our application"
  oc new-project csi-secrets-demo
  echo "Adding privileged permissions to the csi driver service account in ${NAMESPACE}"
  oc adm policy add-scc-to-user privileged system:serviceaccount:${NAMESPACE}:secrets-store-csi-driver
  oc adm policy add-scc-to-user privileged system:serviceaccount:${NAMESPACE}:csi-secrets-store-provider-aws

  echo "Adding Kubernetes Sigs Helm Repo"
  helm repo add secrets-store-csi-driver https://kubernetes-sigs.github.io/secrets-store-csi-driver/charts
  helm repo update

  echo "Installing the cs-secrets-store helm chart"
  helm upgrade --install -n csi-secrets-store csi-secrets-store-driver secrets-store-csi-driver/secrets-store-csi-driver
  oc -n csi-secrets-store apply -f https://raw.githubusercontent.com/rh-mobb/documentation/main/content/docs/misc/secrets-store-csi/aws-provider-installer.yaml


  export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

  get_oidc_provider
  echo "Creating Trust policy document for the service account"
  cat <<EOF > ./demo4/trust-policy.json
{
  "Version": "2012-10-17",
  "Statement": [
  {
  "Effect": "Allow",
  "Condition": {
    "StringEquals" : {
      "${OIDC_PROVIDER}:sub": ["system:serviceaccount:csi-secrets-demo:default"]
    }
  },
  "Principal": {
    "Federated": "arn:aws:iam::${AWS_ACCOUNT_ID}:oidc-provider/${OIDC_PROVIDER}"
  },
  "Action": "sts:AssumeRoleWithWebIdentity"
  }
  ]
}
EOF

  echo "Creating Role ${CLUSTER}-access-to-aws-secret for the service account"
  ROLE_ARN=$(aws iam create-role --role-name ${CLUSTER}-access-to-aws-secret \
  --assume-role-policy-document file://./demo4/trust-policy.json \
  --query Role.Arn --output text)

  echo "Annotating the service account to use the Role ARN"
  oc annotate -n csi-secrets-demo  serviceaccount default eks.amazonaws.com/role-arn=$ROLE_ARN

  echo "Creating secrets provider class"
  cat << EOF | oc apply -n csi-secrets-demo -f -
apiVersion: secrets-store.csi.x-k8s.io/v1
kind: SecretProviderClass
metadata:
  name: my-application-aws-secrets
spec:
  provider: aws
  parameters:
    objects: |
        - objectName: "MySecret-${CLUSTER}"
          objectType: "secretsmanager"
EOF

  echo "Demo4 is ready! Proceed to ./demo-4.md for your demo"
}

clean_demo4 () {
  prep_demo4

  echo "Cleaning up project"
  oc delete project csi-secrets-demo || echo "Project already deleted"
  oc delete project csi-secrets-store || echo "Project already deleted"

  echo "Checking if secrets-store and driver are installed via helm"
  if helm list -n csi-secrets-store | grep csi-secrets-store-driver; then
    echo "Removing csi secrets store and driver via helm"
    helm delete -n csi-secrets-store csi-secrets-store-driver
  fi

  echo "Cleaning up additional scc permissions from service accounts"
  oc adm policy remove-scc-from-user privileged system:serviceaccount:${NAMESPACE}:secrets-store-csi-driver || echo "SCC already removed for CSI driver"
  oc adm policy remove-scc-from-user privileged system:serviceaccount:${NAMESPACE}:csi-secrets-store-provider-aws || echo "SCC already removed for AWS provider"

  echo "Deleting the aws provider"
  # To-DO: make this cleaner, it's not future proof
  set +e
  oc -n csi-secrets-store delete -f https://raw.githubusercontent.com/rh-mobb/documentation/main/content/docs/misc/secrets-store-csi/aws-provider-installer.yaml

  echo "Checking if role ${CLUSTER}-access-to-aws-secret exists"
  ROLE_CHECK=$(aws iam list-roles | grep ${CLUSTER}-access-to-aws-secret)
  echo $ROLE_CHECK
  set -e
  if [ -n "${ROLE_CHECK}" ]; then
    POLICY_ARN=$(aws iam list-policies --query "Policies[?PolicyName=='${CLUSTER}-access-to-aws-secret'].{ARN:Arn}" --output text)
    echo "Removing role policy ${CLUSTER}-access-to-aws-secret from ${POLICY_ARN}"
    aws iam detach-role-policy --role-name "${CLUSTER}-access-to-aws-secret" --policy-arn ${POLICY_ARN} || echo "Policy already detached"

    echo "Removing role ${CLUSTER}-access-to-aws-secret"
    aws iam delete-role --role-name "${CLUSTER}-access-to-aws-secret"
  fi

  echo "Cleaning up secret from secretsmanager"
  set +e
  SECRET_ARN=$(aws secretsmanager list-secrets --query 'SecretList[].[ARN]' --output text | grep MySecret-$CLUSTER)
  set -e
  aws secretsmanager --region $REGION delete-secret --secret-id $SECRET_ARN --force-delete-without-recovery || echo "Secret already deleted"
}

prep_demo5 () {
  R='\033[0;31m'
  B='\033[0;36m'
  NC='\033[0m'

  printf "${R}To run this demo you will need two clusters\n"
  printf "The api url, username and password are required for both\n"
  printf "You will be asked for the details of each cluster, the password is shadowed\n ${NC}"

  printf "${B}Cluster 1 details${NC}\n"
  read -p "     Cluster 1 api url? " CLUSTER1_API
  read -p "     Cluster 1 username? " CLUSTER1_USERNAME
  echo "     Cluster 1 password? "
  IFS= read -rs  CLUSTER1_PASSWORD

  export CLUSTER1_API
  export CLUSTER1_USERNAME
  export CLUSTER1_PASSWORD

  printf "${B}Cluster 2 details${NC}\n"
  read -p "     Cluster 2 api url? " CLUSTER2_API
  read -p "     Cluster 2 username? " CLUSTER2_USERNAME
  echo "     Cluster 2 password? "
  IFS= read -rs  CLUSTER2_PASSWORD

  export CLUSTER2_API
  export CLUSTER2_USERNAME
  export CLUSTER2_PASSWORD
}

install_demo5 () {

  R='\033[0;31m'
  B='\033[0;36m'
  NC='\033[0m'

  if ! command -v skupper &> /dev/null
    then
      echo "Please install skupper to continue"
      exit
  fi

  prep_demo5

  echo "Deploy frontend patient portal to cluster 1"
  oc login $CLUSTER1_API --username $CLUSTER1_USERNAME --password $CLUSTER1_PASSWORD

  echo ""
  echo "Create new project for the front end portal"
  oc new-project patient-portal-frontend
  echo ""
  echo "Deploy the application"
  oc new-app quay.io/redhatintegration/patient-portal-frontend

  echo ""
  echo "Set up infrastructure to expose the app"
  oc expose deployment patient-portal-frontend --port=8080
  oc create route edge --service=patient-portal-frontend --insecure-policy=Redirect
  echo "Here is the front end url"
  printf "${B}https://`oc get routes/patient-portal-frontend -o jsonpath={.spec.host}`\n${nc}"
  read -p "Press key to continue"

  oc set env deployment/patient-portal-frontend DATABASE_SERVICE_HOST=database

  # Log into other cluster
  oc login $CLUSTER2_API --username $CLUSTER2_USERNAME --password $CLUSTER2_PASSWORD
  echo "Create project and deploy the patient portal database"
  oc new-project private
  oc new-app quay.io/redhatintegration/patient-portal-database
  echo "Wait DB deployment"
  DB_STATUS=""
  while [ DB_STATUS == "" ]
  do
    current_status=`oc rollout status deployment patient-portal-database`
    if [ echo $current_status | grep -v "Waiting" ]
    then
      break
    fi
    echo $current_status
  done

  echo "Deploy payment processor service and expose that 'internally'"
  oc new-app quay.io/redhatintegration/patient-portal-payment-processor
  oc expose deployment patient-portal-payment-processor --name=payment-processor --port=8080

  # All apps are now installed

  #Public
  skupper init --enable-console --enable-flow-collector --console-auth unsecured
  # Check skupper console

  #Private
  skupper init --ingress none --router-mode edge --enable-console=false

  #Public
  skupper token create ~/secret.token
  cat root/secret.token

  #You now copy the secret to a location that can be called by the next command for the private terminal
  skupper link create home/secret.token
  skupper link status
  # Check skupper console
  # Check front end, it should still be empty
  # Skupper console components tab no lines between the components
  # Terminal private
  skupper expose deployment/patient-portal-database --address database --protocol tcp --port 5432
  skupper expose deployment/patient-portal-payment-processor --address payment-processor --protocol http --port 8080

  # None of this exposes the "internal" apps publically
  # To confirm terminal public
  oc get service
  # Now check the front end and see its populated with data
  # Select top one
  # Select Bills
  # Pay bill
  # Refresh screen
  # Goto skupper screen and checkout them arrows


}


clean_demo5 () {

  prep_demo5
  
  echo "Delete frontend patient portal"
  oc login $CLUSTER1_API --username $CLUSTER1_USERNAME --password $CLUSTER1_PASSWORD
  oc delete project patient-portal-frontend

  # Log into other cluster
  oc login $CLUSTER2_API --username $CLUSTER2_USERNAME --password $CLUSTER2_PASSWORD
  oc project private
  oc new-app quay.io/redhatintegration/patient-portal-database
  # We need to wait until this is runnung 
  oc new-app quay.io/redhatintegration/patient-portal-payment-processor
  oc expose deployment patient-portal-payment-processor --name=payment-processor --port=8080

  # All apps are now installed

  #Public
  skupper init --enable-console --enable-flow-collector --console-auth unsecured
  # Check skupper console

  #Private
  skupper init --ingress none --router-mode edge --enable-console=false

  #Public
  skupper token create ~/secret.token
  cat root/secret.token

  #You now copy the secret to a location that can be called by the next command for the private terminal
  skupper link create home/secret.token
  skupper link status
  # Check skupper console
  # Check front end, it should still be empty
  # Skupper console components tab no lines between the components
  # Terminal private
  skupper expose deployment/patient-portal-database --address database --protocol tcp --port 5432
  skupper expose deployment/patient-portal-payment-processor --address payment-processor --protocol http --port 8080

  # None of this exposes the "internal" apps publically
  # To confirm terminal public
  oc get service
  # Now check the front end and see its populated with data
  # Select top one
  # Select Bills
  # Pay bill
  # Refresh screen
  # Goto skupper screen and checkout them arrows


}

# main

if [ -z ${1+x} ]; then echo "Please provide a command"; help; fi

type $1 >/dev/null 2>&1 || { echo >&2 "$1 is not a valid function in this script.  Aborting."; help; exit 1; }
# Exec function desired as first argument
$1