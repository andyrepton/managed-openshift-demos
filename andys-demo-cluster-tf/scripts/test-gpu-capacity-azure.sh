#!/usr/bin/env bash
#
# Test GPU VM capacity across availability zones in a given Azure region.
# Uses az cli to check SKU availability and quota restrictions.
# Unlike the AWS script, this does NOT launch real VMs — Azure exposes
# capacity/restriction info via the SKU API.
#
# Usage: ./test-gpu-capacity-azure.sh <region> [vm-size ...]
#
# If no VM sizes are given, discovers all GPU SKUs available in the region.
#
# Examples:
#   ./test-gpu-capacity-azure.sh westeurope
#   ./test-gpu-capacity-azure.sh uksouth Standard_NC40ads_H100_v5 Standard_NV36ads_A10_v5
#
set -euo pipefail

REGION="${1:?Usage: $0 <region> [vm-size ...]}"
shift

if ! command -v az &>/dev/null; then
  echo "Error: az CLI not found. Install it from https://learn.microsoft.com/en-us/cli/azure/install-azure-cli"
  exit 1
fi

# Check we're logged in
az account show --query '{Sub:name,Id:id}' -o table 2>/dev/null || {
  echo "Error: not logged into Azure. Run 'az login' first."
  exit 1
}

if [ $# -gt 0 ]; then
  VM_SIZES=("$@")
else
  echo "Discovering GPU VM sizes in $REGION..."
  VM_SIZES=()
  while IFS= read -r line; do
    VM_SIZES+=("$line")
  done < <(
    az vm list-skus --location "$REGION" --resource-type virtualMachines \
      --query "[?family=='standardNCFamily' || family=='standardNCSv3Family' || family=='standardNCASv3_T4Family' || family=='standardNCADSA100v4Family' || family=='standardNCADSH100v5Family' || family=='standardNVFamily' || family=='standardNVSv3Family' || family=='standardNVADSA10v5Family' || family=='standardNDSv2Family' || family=='standardNDASv4_A100Family' || family=='standardNDSH100v5Family' || family=='standardNVSv4Family' || family=='standardNCEADSH100v5Family' || contains(family, 'NC') || contains(family, 'NV') || contains(family, 'ND')].name" \
      -o tsv 2>/dev/null | sort -u
  )
  echo "Found ${#VM_SIZES[@]} GPU sizes"
fi

echo ""
echo "Region: $REGION"
echo "Sizes:  ${VM_SIZES[*]}"
echo ""

for SIZE in "${VM_SIZES[@]}"; do
  echo "--- $SIZE ---"

  # Get SKU details including restrictions and zones
  SKU_INFO=$(az vm list-skus --location "$REGION" --resource-type virtualMachines \
    --size "$SIZE" --query "[0]" -o json 2>/dev/null)

  if [ -z "$SKU_INFO" ] || [ "$SKU_INFO" = "null" ]; then
    echo "  Not offered in $REGION"
    echo ""
    continue
  fi

  # Check for restrictions
  RESTRICTIONS=$(echo "$SKU_INFO" | python3 -c "
import json, sys
sku = json.load(sys.stdin)
restrictions = sku.get('restrictions', [])
if not restrictions:
    print('NONE')
else:
    for r in restrictions:
        rtype = r.get('type', 'Unknown')
        reason = r.get('reasonCode', 'Unknown')
        vals = r.get('restrictionInfo', {}).get('zones', [])
        if rtype == 'Location':
            print(f'BLOCKED: {reason} (entire region)')
        elif rtype == 'Zone':
            print(f'RESTRICTED: {reason} in zones {vals}')
        else:
            print(f'{rtype}: {reason}')
" 2>/dev/null)

  # Get available zones
  ZONES=$(echo "$SKU_INFO" | python3 -c "
import json, sys
sku = json.load(sys.stdin)
zones = []
for loc in sku.get('locationInfo', []):
    zones.extend(loc.get('zones', []))
print(' '.join(sorted(set(zones))) if zones else 'no-zones')
" 2>/dev/null)

  # Get GPU count and memory from capabilities
  GPU_INFO=$(echo "$SKU_INFO" | python3 -c "
import json, sys
sku = json.load(sys.stdin)
caps = {c['name']: c['value'] for c in sku.get('capabilities', [])}
gpus = caps.get('GPUs', '?')
mem = caps.get('MemoryGB', '?')
vcpus = caps.get('vCPUs', '?')
print(f'{gpus} GPU(s), {vcpus} vCPUs, {mem} GB RAM')
" 2>/dev/null)

  echo "  Spec: $GPU_INFO"
  echo "  Zones: $ZONES"

  if [ "$RESTRICTIONS" = "NONE" ]; then
    echo "  Status: AVAILABLE"
    echo "  >>> $SIZE has capacity in $REGION"
  else
    echo "  Status: $RESTRICTIONS"
  fi

  echo ""
done

# Single quota lookup at the end (az vm list-usage is slow, avoid calling per-SKU)
echo "=== GPU Family Quotas in $REGION ==="
az vm list-usage --location "$REGION" \
  --query "[?contains(localName, 'NC') || contains(localName, 'NV') || contains(localName, 'ND')].{Name:localName,Used:currentValue,Limit:limit}" \
  -o table 2>/dev/null || true
