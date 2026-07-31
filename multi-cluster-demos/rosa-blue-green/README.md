# ROSA HCP Blue-Green Deployment

Terraform project for deploying ROSA HCP (Hosted Control Planes) clusters in a blue-green configuration. Supports multiple independent cluster pairs, connected via an AWS Transit Gateway, with individually controllable OpenShift versions for zero-downtime upgrades.

## Architecture

```
                         ┌──────────────────────────┐
                         │      Transit Gateway      │
                         │    (connects all VPCs)     │
                         └──┬───────┬───────┬───┬────┘
                            │       │       │   │
              ┌─────────────┘       │       │   └──────────────┐
              │                     │       │                  │
   ┌──────────┴───────┐  ┌─────────┴──────┐│  ┌───────────────┴──┐
   │  VPC (Prod Blue)  │  │ VPC (Prod Grn) ││  │  VPC (Stg Blue)  │ ...
   │  10.0.0.0/24      │  │ 10.0.1.0/24    ││  │  10.0.2.0/24     │
   │                   │  │                ││  │                  │
   │ ┌───────────────┐ │  │ ┌─────────────┐││  │ ┌──────────────┐ │
   │ │  LB Subnets   │ │  │ │ LB Subnets  │││  │ │  LB Subnets  │ │
   │ │  3x /28       │ │  │ │ 3x /28      │││  │ │  3x /28      │ │
   │ │  (public)     │ │  │ │ (public)    │││  │ │  (public)    │ │
   │ └───────────────┘ │  │ └─────────────┘││  │ └──────────────┘ │
   │ ┌───────────────┐ │  │ ┌─────────────┐││  │ ┌──────────────┐ │
   │ │  App Subnets  │ │  │ │ App Subnets │││  │ │  App Subnets │ │
   │ │  3x /26       │ │  │ │ 3x /26      │││  │ │  3x /26      │ │
   │ │  (private)    │ │  │ │ (private)   │││  │ │  (private)   │ │
   │ └───────────────┘ │  │ └─────────────┘││  │ └──────────────┘ │
   │                   │  │                ││  │                  │
   │   ROSA HCP        │  │  ROSA HCP      ││  │   ROSA HCP       │
   │   v4.17.10        │  │  v4.17.10      ││  │   v4.17.10       │
   └───────────────────┘  └────────────────┘│  └──────────────────┘
                                            │
        ── Production Pair ──               │  ── Staging Pair ──
                                            │
                                  ┌─────────┴────────┐
                                  │ VPC (Stg Green)   │
                                  │ 10.0.3.0/24       │
                                  │  ...               │
                                  └───────────────────┘
```

Each cluster gets its own VPC with:
- **Load balancer subnets** (public, 3x /28): for ingress controllers and external-facing services
- **Application subnets** (private, 3x /26): for ROSA HCP worker nodes — receives 75% of the /24 address space

All VPCs are connected via a Transit Gateway with automatic route propagation, enabling cross-cluster communication.

## Prerequisites

- Terraform >= 1.5.7
- AWS CLI configured with appropriate permissions
- A Red Hat account with ROSA HCP entitlement
- An RHCS token (set via `RHCS_TOKEN` environment variable, or `rosa login` / `ocm login`)
- ROSA HCP prerequisites completed (`rosa verify permissions`, `rosa verify quota`)

## Usage

1. **Copy the example tfvars:**

   ```bash
   cp terraform.tfvars.example terraform.tfvars
   ```

2. **Edit `terraform.tfvars`** to define your cluster pairs:

   ```hcl
   cluster_pairs = {
     "production" = {
       blue_cidr     = "10.0.0.0/24"
       green_cidr    = "10.0.1.0/24"
       blue_version  = "4.17.10"
       green_version = "4.17.10"
     }
   }
   ```

3. **Set your RHCS token:**

   ```bash
   export RHCS_TOKEN="your-ocm-token"
   ```

4. **Deploy:**

   ```bash
   terraform init
   terraform plan
   terraform apply
   ```

## Configuration Reference

### `cluster_pairs`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `blue_cidr` | string | required | VPC CIDR for the blue cluster (e.g. `"10.0.0.0/24"`). Must not overlap with other CIDRs. |
| `green_cidr` | string | required | VPC CIDR for the green cluster (e.g. `"10.0.1.0/24"`). Must not overlap with other CIDRs. |
| `blue_version` | string | required | OpenShift version for the blue cluster |
| `green_version` | string | required | OpenShift version for the green cluster |
| `replicas` | number | 3 | Number of worker nodes (spread across 3 AZs) |
| `machine_type` | string | "m5.xlarge" | EC2 instance type for workers |
| `private` | bool | false | Make cluster API and routes private |
| `upgrade_acknowledgements_for` | string | null | Minor version acknowledgement for upgrades (e.g. "4.18") |
| `machine_pools` | map(object) | {} | Additional machine pools applied to both blue and green clusters in the pair |

#### `machine_pools`

Each entry in the `machine_pools` map creates an additional node pool on both the blue and green clusters in the pair. The pool inherits the cluster's OpenShift version automatically. Uses the official Red Hat `machine-pool` submodule from `terraform-redhat/rosa-hcp/rhcs`.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | string | required | Machine pool name (lowercase alphanumeric and hyphens) |
| `instance_type` | string | required | EC2 instance type (e.g. `"m5.2xlarge"`) |
| `replicas` | number | null | Fixed number of replicas (mutually exclusive with `autoscaling`) |
| `autoscaling` | object | null | `{ enabled = true, min_replicas = 1, max_replicas = 5 }` |
| `labels` | map(string) | null | Kubernetes node labels |
| `taints` | list(object) | null | Kubernetes node taints (`key`, `value`, `schedule_type`) |
| `auto_repair` | bool | true | Automatically repair unhealthy nodes |
| `subnet_index` | number | 0 | Index into the VPC's private subnets (0, 1, or 2 — one per AZ) |
| `aws_tags` | map(string) | {} | Additional AWS tags on the node pool instances |

### `irsa_roles`

| Field | Type | Description |
|-------|------|-------------|
| `cluster_key` | string | Target cluster in `<pair_name>-<color>` format (e.g. "production-blue") |
| `role_name` | string | Descriptive name for the IAM role |
| `namespace` | string | Kubernetes namespace of the service account |
| `service_account` | string | Kubernetes service account name |
| `policy_arns` | list(string) | IAM policy ARNs to attach |

### Adding a new cluster pair

Add an entry to `cluster_pairs` with non-overlapping CIDRs:

```hcl
cluster_pairs = {
  "production" = {
    blue_cidr     = "10.0.0.0/24"
    green_cidr    = "10.0.1.0/24"
    blue_version  = "4.17.10"
    green_version = "4.17.10"
  }
  # New pair:
  "staging" = {
    blue_cidr     = "10.0.2.0/24"
    green_cidr    = "10.0.3.0/24"
    blue_version  = "4.17.10"
    green_version = "4.17.10"
  }
}
```

### Adding machine pools

Define machine pools inside a cluster pair. They are created on both the blue and green clusters:

```hcl
cluster_pairs = {
  "production" = {
    blue_cidr     = "10.0.0.0/24"
    green_cidr    = "10.0.1.0/24"
    blue_version  = "4.17.10"
    green_version = "4.17.10"

    machine_pools = {
      "infra" = {
        name          = "infra"
        instance_type = "m5.2xlarge"
        replicas      = 3
        subnet_index  = 0
        labels = {
          "node-role.kubernetes.io/infra" = ""
        }
        taints = [{
          key           = "node-role.kubernetes.io/infra"
          value         = ""
          schedule_type = "NoSchedule"
        }]
      }
      "gpu" = {
        name          = "gpu"
        instance_type = "g5.2xlarge"
        subnet_index  = 1
        autoscaling = {
          enabled      = true
          min_replicas = 0
          max_replicas = 5
        }
        labels = {
          "nvidia.com/gpu" = "true"
        }
      }
    }
  }
}
```

### Adding IRSA roles

```hcl
irsa_roles = {
  "prod-blue-s3-reader" = {
    cluster_key     = "production-blue"
    role_name       = "s3-reader"
    namespace       = "my-app"
    service_account = "s3-reader-sa"
    policy_arns     = ["arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess"]
  }
}
```

After `terraform apply`, annotate the service account in your cluster:

```bash
oc annotate serviceaccount -n my-app s3-reader-sa \
  eks.amazonaws.com/role-arn=$(terraform output -json irsa_role_arns | jq -r '."prod-blue-s3-reader"')
```

## Upgrade Guide

The blue-green pattern allows you to upgrade one cluster at a time while the other serves traffic.

### Patch version upgrade (e.g. 4.17.8 -> 4.17.10)

1. **Upgrade the blue cluster first.** Edit `terraform.tfvars`:

   ```hcl
   cluster_pairs = {
     "production" = {
       blue_cidr     = "10.0.0.0/24"
       green_cidr    = "10.0.1.0/24"
       blue_version  = "4.17.10"   # <- upgraded
       green_version = "4.17.8"    # <- still on old version
     }
   }
   ```

2. **Apply:**

   ```bash
   terraform plan    # Review: only production-blue cluster changes
   terraform apply
   ```

3. **Validate** the blue cluster is healthy (check workloads, run smoke tests).

4. **Upgrade green.** Update `green_version` to `"4.17.10"` and apply again.

### Minor version upgrade (e.g. 4.17.x -> 4.18.x)

Minor version upgrades require explicit acknowledgement of breaking changes.

1. **Upgrade blue:**

   ```hcl
   cluster_pairs = {
     "production" = {
       blue_cidr                    = "10.0.0.0/24"
       green_cidr                   = "10.0.1.0/24"
       blue_version                 = "4.18.2"
       green_version                = "4.17.10"
       upgrade_acknowledgements_for = "4.18"  # Required for minor version jumps
     }
   }
   ```

2. **Apply and validate**, same as patch upgrades.

3. **Upgrade green** by changing `green_version` and applying again.

4. **Remove acknowledgement** after both clusters are upgraded:

   ```hcl
   upgrade_acknowledgements_for = null  # or remove the line
   ```

### Rollback

If the upgraded cluster has issues, shift traffic back to the non-upgraded cluster using your load balancer or DNS configuration. The non-upgraded cluster remains untouched throughout the process. Once the issue is resolved, you can retry the upgrade.

### Pre-upgrade checklist

- [ ] Check available versions: `rosa list versions --hosted-cp`
- [ ] Review the [OpenShift release notes](https://docs.openshift.com/rosa/rosa_release_notes/rosa-release-notes.html) for breaking changes
- [ ] Ensure workloads on the target cluster can tolerate a rolling restart
- [ ] Verify your IRSA roles and policies are compatible with the new version
- [ ] Run `terraform plan` and confirm only the intended cluster is affected

## Module Versions

| Module | Version | Source |
|--------|---------|--------|
| ROSA HCP | 1.7.4 | `terraform-redhat/rosa-hcp/rhcs` |
| VPC | 6.6.1 | `terraform-aws-modules/vpc/aws` |
| Transit Gateway | 3.2.0 | `terraform-aws-modules/transit-gateway/aws` |

| Provider | Version |
|----------|---------|
| `hashicorp/aws` | >= 5.38.0 |
| `terraform-redhat/rhcs` | >= 1.7.7 |

## Subnet Design

Each VPC uses a CIDR block (set via `blue_cidr`/`green_cidr` in tfvars) split into two tiers:

| Tier | Subnets | Size | Total IPs | Purpose |
|------|---------|------|-----------|---------|
| Load Balancer | 3x /28 (public) | 16 each | 48 | Ingress, external LBs |
| Application | 3x /26 (private) | 64 each | 192 | ROSA worker nodes |

The application tier receives 75% of the address space. Each tier spans all 3 availability zones.

## Cleanup

```bash
terraform destroy
```

This will remove all clusters, VPCs, the transit gateway, and any IRSA roles. ROSA HCP cluster deletion takes approximately 15-20 minutes.
