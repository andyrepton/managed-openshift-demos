#!/usr/bin/env bash
#
# Test GPU instance capacity across availability zones in a given AWS region.
# Creates a temporary VPC, launches a real instance to confirm capacity,
# then immediately terminates and cleans up.
#
# Usage: ./test-gpu-capacity.sh <region> [instance-type ...]
#
# If no instance types are given, discovers all GPU/accelerator types in the region.
#
# Examples:
#   ./test-gpu-capacity.sh us-east-1
#   ./test-gpu-capacity.sh eu-west-2 g7e.2xlarge p5.4xlarge
#
set -euo pipefail

REGION="${1:?Usage: $0 <region> [instance-type ...]}"
shift

if [ $# -gt 0 ]; then
  INSTANCE_TYPES=("$@")
else
  echo "Discovering GPU/accelerator instance types in $REGION..."
  INSTANCE_TYPES=()
  while IFS= read -r line; do
    INSTANCE_TYPES+=("$line")
  done < <(
    aws ec2 describe-instance-type-offerings --region "$REGION" \
      --query 'InstanceTypeOfferings[].InstanceType' --output text \
    | tr '\t' '\n' \
    | grep -E '^(p[0-9]|g[0-9]|dl[0-9]|trn[0-9]|inf[0-9])' \
    | sort -u -t. -k1,1 -k2,2n
  )
  echo "Found ${#INSTANCE_TYPES[@]} types"
fi

AMI=$(aws ec2 describe-images --region "$REGION" \
  --owners amazon \
  --filters "Name=name,Values=al2023-ami-2023*-x86_64" "Name=state,Values=available" \
  --query 'sort_by(Images, &CreationDate)[-1].ImageId' \
  --output text)

echo ""
echo "Region: $REGION"
echo "AMI:    $AMI"
echo "Types:  ${INSTANCE_TYPES[*]}"

# Create a temporary VPC with one subnet per AZ
echo ""
echo "Creating temporary VPC for capacity testing..."
VPC_ID=$(aws ec2 create-vpc --region "$REGION" \
  --cidr-block 10.255.0.0/16 \
  --tag-specifications 'ResourceType=vpc,Tags=[{Key=Name,Value=gpu-capacity-test},{Key=purpose,Value=capacity-test}]' \
  --query 'Vpc.VpcId' --output text)
echo "VPC: $VPC_ID"

cleanup() {
  echo ""
  echo "Cleaning up VPC $VPC_ID..."

  # Terminate any instances still in the VPC
  INSTANCE_IDS=$(aws ec2 describe-instances --region "$REGION" \
    --filters "Name=vpc-id,Values=$VPC_ID" \
      "Name=instance-state-name,Values=pending,running,shutting-down,stopping,stopped" \
    --query 'Reservations[].Instances[].InstanceId' --output text 2>/dev/null)
  if [ -n "$INSTANCE_IDS" ] && [ "$INSTANCE_IDS" != "None" ]; then
    echo "  Terminating instances: $INSTANCE_IDS"
    aws ec2 terminate-instances --region "$REGION" --instance-ids $INSTANCE_IDS >/dev/null 2>&1 || true
    echo "  Waiting for termination..."
    aws ec2 wait instance-terminated --region "$REGION" --instance-ids $INSTANCE_IDS 2>/dev/null || true
  fi

  for SID in $(aws ec2 describe-subnets --region "$REGION" \
    --filters "Name=vpc-id,Values=$VPC_ID" \
    --query 'Subnets[].SubnetId' --output text 2>/dev/null); do
    aws ec2 delete-subnet --region "$REGION" --subnet-id "$SID" 2>/dev/null || true
  done
  aws ec2 delete-vpc --region "$REGION" --vpc-id "$VPC_ID" 2>/dev/null || true
  echo "Done."
}
trap cleanup EXIT

ALL_AZS=$(aws ec2 describe-availability-zones --region "$REGION" \
  --filters "Name=state,Values=available" \
  --query 'AvailabilityZones[].ZoneName' --output text | tr '\t' '\n' | sort)

# Build AZ->subnet mapping as parallel arrays (bash 3 compatible)
AZ_NAMES=()
AZ_SUBNET_IDS=()
SUBNET_INDEX=0
for AZ in $ALL_AZS; do
  CIDR="10.255.$SUBNET_INDEX.0/24"
  SID=$(aws ec2 create-subnet --region "$REGION" \
    --vpc-id "$VPC_ID" \
    --cidr-block "$CIDR" \
    --availability-zone "$AZ" \
    --query 'Subnet.SubnetId' --output text 2>/dev/null) || true
  if [ -n "$SID" ] && [ "$SID" != "None" ]; then
    AZ_NAMES+=("$AZ")
    AZ_SUBNET_IDS+=("$SID")
  fi
  SUBNET_INDEX=$((SUBNET_INDEX + 1))
done

echo "Subnets: ${#AZ_NAMES[@]} AZs"
echo ""

get_subnet_for_az() {
  local target="$1"
  local i
  for i in "${!AZ_NAMES[@]}"; do
    if [ "${AZ_NAMES[$i]}" = "$target" ]; then
      echo "${AZ_SUBNET_IDS[$i]}"
      return
    fi
  done
}

for ITYPE in "${INSTANCE_TYPES[@]}"; do
  echo "--- $ITYPE ---"

  AZS=$(aws ec2 describe-instance-type-offerings --region "$REGION" \
    --location-type availability-zone \
    --filters "Name=instance-type,Values=$ITYPE" \
    --query 'InstanceTypeOfferings[].Location' --output text 2>/dev/null \
    | tr '\t' '\n' | sort)

  if [ -z "$AZS" ]; then
    echo "  Not offered in $REGION"
    echo ""
    continue
  fi

  FOUND=false
  for AZ in $AZS; do
    SUBNET=$(get_subnet_for_az "$AZ")
    if [ -z "$SUBNET" ]; then
      echo "  $AZ: NO SUBNET (skipped)"
      continue
    fi

    echo -n "  $AZ: "

    RESULT=$(aws ec2 run-instances --region "$REGION" \
      --instance-type "$ITYPE" \
      --image-id "$AMI" \
      --subnet-id "$SUBNET" \
      --count 1 \
      --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=gpu-capacity-test},{Key=purpose,Value=capacity-test}]' \
      --output json 2>&1) || true

    if echo "$RESULT" | grep -q "InsufficientInstanceCapacity"; then
      echo "NO CAPACITY"
    elif echo "$RESULT" | grep -q "Unsupported"; then
      echo "NOT SUPPORTED IN AZ"
    elif echo "$RESULT" | grep -q "LimitExceeded"; then
      echo "QUOTA LIMIT (capacity exists)"
      FOUND=true
      break
    elif echo "$RESULT" | grep -q "InstanceId"; then
      IID=$(echo "$RESULT" | python3 -c "import json,sys; print(json.load(sys.stdin)['Instances'][0]['InstanceId'])")
      echo "AVAILABLE — terminated $IID"
      aws ec2 terminate-instances --region "$REGION" --instance-ids "$IID" --output text >/dev/null 2>&1
      FOUND=true
      break
    else
      ERR=$(echo "$RESULT" | sed -n 's/.*operation: //p' | head -1)
      echo "ERROR: ${ERR:-unknown}"
    fi
  done

  if [ "$FOUND" = true ]; then
    echo "  >>> $ITYPE has capacity in $REGION"
  fi
  echo ""
done
