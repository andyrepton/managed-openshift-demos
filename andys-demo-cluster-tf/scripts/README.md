# GPU Capacity Test Scripts

Test GPU instance availability before provisioning clusters. Useful for finding which region/AZ actually has capacity for GPU workloads.

## AWS

```bash
# Test a specific instance type in a region
./test-gpu-capacity-aws.sh eu-west-2 g7e.2xlarge

# Test multiple instance types
./test-gpu-capacity-aws.sh us-east-1 g5.2xlarge g7e.2xlarge p5.4xlarge

# Discover and test all GPU types in a region (slow)
./test-gpu-capacity-aws.sh eu-central-1
```

Creates a temporary VPC, attempts to launch a real instance in each AZ, reports which AZs have capacity, then terminates and cleans up. Requires `aws` CLI with valid credentials.

## Azure

```bash
# Test a specific VM size in a region
./test-gpu-capacity-azure.sh uksouth Standard_NC40ads_H100_v5

# Test multiple VM sizes
./test-gpu-capacity-azure.sh westeurope Standard_NC40ads_H100_v5 Standard_NV36ads_A10_v5

# Discover all GPU SKUs in a region
./test-gpu-capacity-azure.sh westeurope
```

Queries the Azure SKU API for availability and quota restrictions. Does not launch real VMs. Requires `az` CLI with valid login.
