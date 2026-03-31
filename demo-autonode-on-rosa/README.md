# Autonode

Instructions:

```
cd terraform-rosa
terraform apply

## wait until done
## make admin

rosa create admin -c andyr-autonode

## Get cluster id
CLUSTER_ID=$(terraform output -raw cluster_id)

## Important, this is designed for ZShell, if you are using bash, edit this!

SECURITY_GROUP_IDS=(${(z)$(aws ec2 describe-security-groups \
    --filters "Name=tag:Name,Values=$CLUSTER_ID-default-sg" \
    --query 'SecurityGroups[*].GroupId' \
    --output text)})

PRIVATE_SUBNET_IDS=(${(z)$(aws ec2 describe-subnets \
    --filters "Name=tag:kubernetes.io/cluster/$CLUSTER_ID,Values=shared" \
    --query 'Subnets[*].SubnetId' \
    --output text)})

aws ec2 create-tags \
        --resources "${SECURITY_GROUP_IDS[@]}" "${PRIVATE_SUBNET_IDS[@]}" \
        --tags Key="karpenter.sh/discovery",Value="$CLUSTER_ID"
```


Now the cluster is made, test autonode:

```
sed "s/CLUSTER_ID/$CLUSTER_ID/g" openshiftec2nodeclass.tmpl > openshiftec2nodeclass.yaml

oc apply -f openshiftec2nodeclass.yaml
oc apply -f nodepool.yaml
```

## Create stress test:

```
oc apply -f stress-test.yaml
```
