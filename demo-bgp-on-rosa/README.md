# BGP Direct Routing on ROSA HCP

Demonstrates Layer 3 direct (non-NAT) routing for pod networks on ROSA HCP using the [bgp-cloud-connector](https://github.com/openshift/bgp-cloud-connector) operator and AWS VPC Route Server.

Pods on a Cluster User-Defined Network (CUDN) get IPs that are directly routable from within the VPC — no NodePort, no LoadBalancer, no NAT. This is particularly useful for OpenShift Virtualization VMs that need to be addressed as native hosts on the network.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        AWS VPC (10.0.0.0/16)                │
│                                                             │
│  ┌─────────────────┐       BGP (TCP 179)       ┌────────┐  │
│  │ m5.metal worker  │◄────────────────────────►│  VPC   │  │
│  │ (bgp_router=true)│  AS 65001 ◄──► AS 65000  │ Route  │  │
│  │                  │                           │ Server │  │
│  │  ┌────────────┐  │                           └───┬────┘  │
│  │  │ FRR-K8S    │  │                               │       │
│  │  │ (frr pod)  │  │                     propagates routes  │
│  │  └────────────┘  │                               │       │
│  │                  │                           ┌───▼────┐  │
│  │  ┌────────────┐  │                           │ Subnet │  │
│  │  │ Pod on CUDN │  │  ◄─── directly routable  │ Route  │  │
│  │  │ 10.100.x.x │  │       from any subnet     │ Tables │  │
│  │  └────────────┘  │                           └────────┘  │
│  └─────────────────┘                                        │
└─────────────────────────────────────────────────────────────┘
```

## Prerequisites

- OpenShift 4.21+ (for CUDN and RouteAdvertisements APIs)
- AWS region with VPC Route Server support (eu-west-2, us-east-1, us-east-2, etc.)
- `oc` CLI logged into the cluster

## Step 1: Deploy Infrastructure

From `andys-demo-cluster-tf/`:

```bash
source ~/.secrets/tf-setup.sh
export RHCS_TOKEN=$(ocm token)
terraform apply -var-file=bgp_rosa.tfvars
```

This creates:
- ROSA HCP cluster with an m5.metal worker node (labeled `bgp_router=true`)
- AWS VPC Route Server with endpoints in each private subnet
- Route propagation to all subnet route tables
- RFC1918 security group on the metal node
- IRSA role for the bgp-cloud-connector operator

Note the outputs:
```bash
terraform output bgp_iam_role_arn
terraform output bgp_route_server_id
terraform output bgp_endpoint_ips
```

## Step 2: Build and Deploy the Operator

The operator is built in-cluster using OpenShift Builds (local builds won't work on ARM Macs).

```bash
# Create namespace and build resources
oc create namespace openshift-bgp-cloud-connector --dry-run=client -o yaml | oc apply -f -
oc create imagestream bgp-cloud-connector -n openshift-bgp-cloud-connector

# Create BuildConfig
cat <<'EOF' | oc apply -f -
apiVersion: build.openshift.io/v1
kind: BuildConfig
metadata:
  name: bgp-cloud-connector
  namespace: openshift-bgp-cloud-connector
spec:
  output:
    to:
      kind: ImageStreamTag
      name: bgp-cloud-connector:latest
  source:
    type: Git
    git:
      uri: https://github.com/openshift/bgp-cloud-connector.git
      ref: main
  strategy:
    type: Docker
    dockerStrategy:
      dockerfilePath: Dockerfile
  triggers: []
EOF

# Build the image
oc start-build bgp-cloud-connector -n openshift-bgp-cloud-connector --follow
```

Deploy using the operator's kustomize config:
```bash
git clone https://github.com/openshift/bgp-cloud-connector.git /tmp/bgp-cloud-connector

# Point the kustomize image to the in-cluster build
sed -i '' 's|newName: controller|newName: image-registry.openshift-image-registry.svc:5000/openshift-bgp-cloud-connector/bgp-cloud-connector|' \
  /tmp/bgp-cloud-connector/config/manager/kustomization.yaml

oc kustomize /tmp/bgp-cloud-connector/config/default | oc apply -f -
```

## Step 3: Configure AWS Credentials (IRSA)

Annotate the operator's ServiceAccount with the IAM role from Terraform:

```bash
ROLE_ARN=$(cd andys-demo-cluster-tf && terraform output -raw bgp_iam_role_arn)

oc annotate serviceaccount openshift-bgp-cloud-connector-controller-manager \
  -n openshift-bgp-cloud-connector \
  eks.amazonaws.com/role-arn=$ROLE_ARN

oc rollout restart deployment/openshift-bgp-cloud-connector-controller-manager \
  -n openshift-bgp-cloud-connector
```

## Step 4: Apply BGP Configuration

Update `bgp-cloud-configuration.yaml` with your Route Server ID:

```bash
RS_ID=$(cd andys-demo-cluster-tf && terraform output -raw bgp_route_server_id)
sed "s/REPLACE_ME/$RS_ID/" bgp-cloud-configuration.yaml | oc apply -f -
```

Apply the remaining resources:
```bash
oc apply -f cudn.yaml
oc apply -f bgp-routing.yaml
oc apply -f namespace.yaml
oc apply -f test-pod.yaml
```

## Step 5: Install OpenShift Virtualization (optional)

To test BGP routing with VMs:

```bash
oc apply -f ../openshift-virt/operator.yaml
# Wait for CSV to succeed
oc get csv -n openshift-cnv -w
oc apply -f ../openshift-virt/hyperconverged.yaml
# Wait for Available=True
oc get hyperconverged kubevirt-hyperconverged -n openshift-cnv -w
```

Then create a test VM on the CUDN:
```bash
oc apply -f test-vm.yaml
```

## Step 6: Validate

Check operator status (all conditions should be True):
```bash
oc get bgpcloudconfiguration cluster -o jsonpath='{.status.conditions}' | python3 -m json.tool
```

Check BGP peering:
```bash
FRR_POD=$(oc get pods -n openshift-frr-k8s -l app=frr-k8s -o name | head -1)
oc exec -n openshift-frr-k8s $FRR_POD -c frr -- vtysh -c "show bgp summary"
oc exec -n openshift-frr-k8s $FRR_POD -c frr -- vtysh -c "show ip bgp"
```

Verify routes in VPC route tables:
```bash
VPC_ID=$(aws ec2 describe-vpcs --region eu-west-2 --filters "Name=tag:Name,Values=poc-andyr-vpc" \
  --query 'Vpcs[0].VpcId' --output text)
aws ec2 describe-route-tables --region eu-west-2 --filters "Name=vpc-id,Values=$VPC_ID" \
  --query 'RouteTables[*].{Name:Tags[?Key==`Name`].Value|[0],Route:Routes[?DestinationCidrBlock==`10.100.0.0/16`]|[0].State}'
```

Pods and VMs on the CUDN get two IPs:
- **CUDN (primary)**: 10.100.x.x on `ovn-udn1` — directly routable from the VPC
- **Cluster (infrastructure)**: 10.131.x.x on `eth0` — internal cluster network

```bash
oc get pod -n bgp-demo bgp-test -o jsonpath='{.metadata.annotations.k8s\.ovn\.org/pod-networks}' | python3 -m json.tool
oc get vmi -n bgp-demo bgp-test-vm -o jsonpath='{.status.interfaces}' | python3 -m json.tool
```

To verify direct routing works, test from an EC2 instance in the same VPC (not from cluster nodes, which route through OVN):
```bash
ping 10.100.0.x  # Should get a response — traffic routes via VPC Route Server
```

## Cleanup

```bash
oc delete -f test-vm.yaml -f test-pod.yaml -f namespace.yaml -f bgp-routing.yaml -f cudn.yaml
oc delete bgpcloudconfiguration cluster
oc kustomize /tmp/bgp-cloud-connector/config/default | oc delete -f -
cd andys-demo-cluster-tf && terraform destroy -var-file=bgp_rosa.tfvars
```

## Notes

- **Single router node**: This demo uses 1 m5.metal node. VPC Route Server installs only one active route per prefix in the FIB (no ECMP), so a single router works for demo purposes. For production, use 3 across AZs for failover.
- **Source/Dest Check**: The operator automatically disables source/destination checks on the router node's ENIs via the IRSA role.
- **Security Groups**: The metal node needs RFC1918 and allow-all security groups attached (via `additional_security_group_ids` on the machine pool, requires RHCS module >= 1.7.5). Without these, return traffic from CUDN IPs is blocked by the default cluster SG.
- **CUDN label**: The CUDN must have `advertise: "true"` label to be selected by the operator's RouteAdvertisements.
- **Testing from cluster nodes**: Pings from other cluster nodes go through OVN (not the VPC route table), so they're not a valid test of BGP routing. Use an EC2 instance in the same VPC instead.
- **Replicas quirk**: The RHCS provider reports `replicas` as the total compute across all pools. If terraform plan shows a replicas mismatch, use `terraform apply -refresh-only` targeting the cluster resource.
- Based on the [rosa-bgp PoC](https://github.com/rh-mobb/rosa-bgp) and [bgp-cloud-connector operator](https://github.com/openshift/bgp-cloud-connector).
