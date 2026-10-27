# andys-demo-cluster-tf

One root module with a **single shared state** across ROSA, ARO, ARO HCP and
OSD. Each `*.tfvars` file is a preset for one product.

## tfvars

**Never use one product's tfvars while targeting another product's module.**
Each preset sets `create_<other> = false`, so targeting `module.aro_hcp` with
`basic_osd.tfvars` sets that module's count to 0 and destroys the ARO HCP
cluster. `-target` does not protect you: Terraform still evaluates the count
from the tfvars. To change several products at once, run separate applies with
each product's own tfvars, or write a combined tfvars with every `create_*`
that must survive set to `true`.

**Check the tfvars region matches the live cluster before planning.** A preset
with the wrong `aws_region` makes the plan replace the VPC's NAT gateways and
route table associations. Read the plan's destroy/replace lines before every
apply.

## GPU machine pools

Before adding a GPU pool or deploying an AI demo, test capacity for the exact
region, AZ and instance type:

```bash
./scripts/test-gpu-capacity-aws.sh <region> <instance-type>
./scripts/test-gpu-capacity-azure.sh <region> <vm-size>
```

An instance type being *offered* in a region is not capacity, and the ROSA
machine pool API rejects a pool outright rather than falling back to another
AZ. `ai_gpu_subnet_index` picks the private subnet, and so the AZ, the pool
lands in: test that AZ, and keep it in the same AZ as any existing model PVC
(EBS volumes are zonal). The AWS script launches a real instance in a temporary
VPC, stops at the first AZ with capacity, and cleans up after itself.

## ROSA HCP teardown

`terraform destroy` removes the cluster (about 30 minutes) but then **hangs on
the VPC**. ROSA creates a `<cluster-id>-vpce-private-router` security group for
its private-router VPC endpoint, deletes the endpoint but not the group, and
the group is not in Terraform state, so AWS refuses to delete the VPC.

Once Terraform is down to only `aws_vpc`:

1. Confirm the cluster is gone in OCM.
2. List what is left in the VPC (security groups, ENIs, VPC endpoints, load
   balancers), read-only.
3. If the only non-default security group is that cluster's
   `-vpce-private-router` group, delete just that group with
   `aws ec2 delete-security-group`. Terraform's retry then finishes the VPC.
   Anything else left in the VPC: stop and ask.

Record the PV volume IDs (`oc get pv`) before destroying, so you can check for
orphaned EBS volumes afterwards.

## LokiStack (`rosa/modules/lokistack/`)

- The S3 bucket must use `AES256` (SSE-S3), not `aws:kms`. KMS needs extra IAM
  permissions, and Loki fails with "Requests specifying Server Side Encryption
  with AWS KMS managed keys require AWS Signature Version 4".
- The trust policy subject is `system:serviceaccount:openshift-logging:logging-loki`.
  The Loki Operator names the SA `logging-loki`, not `loki`.
- The trust policy audience is `openshift`, not `sts.amazonaws.com`: the Loki
  secret's `audience` field sets the projected token audience.

## ARO HCP

- **Version shapes differ.** `aro_hcp_cluster_version` is an `X.Y` stream
  (`4.22`); `aro_hcp_node_pool_version` is a full `X.Y.Z` (`4.22.13`). Never
  guess a patch version: if only the stream is known, omit the node pool
  version and let the module default apply.
- **Pull secret.** There is no `--pull-secret` at create time, and the global
  `pull-secret` in `openshift-config` is reconciled by the hosted control
  plane. Create an `additional-pull-secret` Secret (type
  `kubernetes.io/dockerconfigjson`) in `kube-system`
  ([Microsoft docs](https://learn.microsoft.com/en-us/azure/openshift/how-to-add-pull-secrets))
  **before installing any operators**, or bundle unpack pods cannot pull from
  `registry.redhat.io`. The `global-pull-secret-syncer` DaemonSet merges it
  onto each node. Recreate any subscriptions that failed before it existed.
- **No OpenShift Groups.** There is no in-cluster OAuth server, so
  `groups.user.openshift.io` stays empty. Group-based access breaks in:
  RHOAI Dashboard `groupsConfig`, MaaS `MaaSAuthPolicy` group rules, GitOps
  RBAC `scopes: '[groups]'`, Dev Spaces `allowGroups`/`denyGroups`, LokiStack
  `adminGroups`, ACS auth provider group rules, and ACM ClusterSet bindings.
  Not affected: Service Mesh, Quay, Pipelines, Serverless, Compliance Operator.
  Plan for Entra ID group claims via OIDC, the Group Sync Operator, or
  per-user policies.
- **NVIDIA driver CrashLoopBackOff** is a kernel/DTK mismatch: see
  `../openshift-ai/CLAUDE.md`.
