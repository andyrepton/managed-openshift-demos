# BGP Direct Routing on ROSA HCP

This demo gives pods and virtual machines on Red Hat OpenShift Service on AWS
(ROSA) with hosted control planes IP addresses that the rest of the VPC can
reach directly, with no NAT, NodePort or load balancer in the path. The
[bgp-cloud-connector](https://github.com/openshift/bgp-cloud-connector) operator
peers the cluster with AWS VPC Route Server over BGP and advertises user-defined
network prefixes into the VPC route tables, creating two networks that the VPC
can reach but that cannot reach each other. It is here to show layer 3
integration with AWS networking on a managed cluster, which matters most for
OpenShift Virtualization VMs that need to be addressed like ordinary hosts. It
is a proof of concept for a throwaway cluster.

Tested: 2026-11-05, ROSA HCP 4.22.12, bgp-cloud-connector 1.1.0 (catalog), OpenShift Virtualization 4.22.12, on an existing cluster with the metal pool replaced. Not run: reachability from an EC2 instance (none is provided), cleanup.

Pods and VMs on a Cluster User-Defined Network (CUDN) get IPs that are directly routable from within the VPC: no NodePort, no LoadBalancer, no NAT. This is particularly useful for OpenShift Virtualization VMs that need to be addressed as native hosts on the network.

The demo deploys **two** networks, `red` and `blue`, to show the second property that comes with them: they are both reachable from the VPC, and they cannot reach each other.

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
│  │  │ vm-red      │  │ ◄── directly routable    │ Route  │  │
│  │  │ 10.100.x.x │  │      from any subnet      │ Tables │  │
│  │  └────────────┘  │                           └────────┘  │
│  │  ┌────────────┐  │                                        │
│  │  │ vm-blue     │  │ ◄── also directly routable            │
│  │  │ 10.101.x.x │  │     …but red ⇄ blue is dropped         │
│  │  └────────────┘  │                                        │
│  └─────────────────┘                                        │
└─────────────────────────────────────────────────────────────┘
```

Both networks share one `BGPCloudConfiguration`, one Route Server, one set of
router nodes and one `RouteAdvertisements`. Only the `BGPRouting` CRs differ.

## Reference architecture

Where this leads: two isolated CUDNs carrying VMs, reachable from an
on-premises site over Direct Connect.

![Two isolated CUDNs reachable from on-premises](images/bgp-two-networks.png)

**This demo builds the in-VPC portion only.** BGP gets both CUDN prefixes into
the VPC route tables, and that is where `rosa/bgp.tf` stops. Extending to
on-premises is additional work this repo does not do, because none of it
follows automatically from the BGP session:

| Hop | Automatic? |
|:---|:---|
| Cluster → VPC subnet route tables | Yes (BGP and route server propagation) |
| VPC → Transit Gateway route table | **No**: a static route per CUDN prefix |
| Transit Gateway → on-premises | **No**: Direct Connect gateway allowed prefixes |
| On-premises → Transit Gateway | Yes (propagated from the Direct Connect attachment) |
| Node → on-premises (return path) | **No**: a route in the VPC subnet route tables |

A Transit Gateway VPC attachment propagates only the *VPC's own CIDR blocks*
into the TGW route table; it never reads your subnet route tables. The CUDN
prefixes live only in the subnet route tables, so the TGW cannot learn them and
needs static routes pointing at the VPC attachment.

Direct Connect must use a **Transit Gateway** association, not a virtual
private gateway. On a TGW association the allowed-prefix list is *originated*
by the Direct Connect gateway, so it can advertise prefixes outside the VPC
CIDR. On a VGW association it only *filters* the VPC CIDR, and a CUDN prefix
could never be advertised at all.

One caveat on those static routes: they do not track BGP. If the cluster
withdraws a prefix, the VPC route tables update but the TGW static route still
points at the VPC attachment, so traffic blackholes inside the VPC rather than
failing over.

## Prerequisites

- OpenShift 4.21+ (for CUDN and RouteAdvertisements APIs)
- AWS region with VPC Route Server support (eu-west-2, us-east-1, us-east-2, etc.)
- `oc` CLI logged into the cluster
- `jq`, to pretty-print JSON output

## Step 1: Deploy Infrastructure

From `andys-demo-cluster-tf/`, apply with `deploy_virt_machine_pool = true` and
`deploy_bgp = true` (the `bgp_rosa.tfvars` preset sets both for a new cluster;
for an existing cluster add `-var deploy_bgp=true` to its own preset):

```bash
# Export your AWS and Red Hat credentials first.
export RHCS_TOKEN=$(ocm token)
terraform apply -var-file=bgp_rosa.tfvars
```

This creates:
- ROSA HCP cluster with an m5.metal worker node (labeled `bgp_router=true`)
- AWS VPC Route Server with endpoints in each private subnet
- Route propagation to all subnet route tables
- RFC1918 and allow-all security groups on the metal node (see the comment on
  `aws_security_group.allow_all` in `rosa/modules/bgp/bgp.tf` for what the
  allow-all group opens and why it was accepted for this PoC)
- An IAM role for the bgp-cloud-connector operator

**Turning BGP on for a metal pool that already exists needs the pool
replaced.** ROSA only accepts a machine pool's security groups and AWS tags
when the pool is created: the plan shows an in-place update, but the apply
fails with `Attribute value cannot be changed`. Replace the pool explicitly
(this deletes the node; workloads on it restart on the new one, about 20
minutes later):

```bash
terraform apply -var-file=<your-preset>.tfvars -var deploy_bgp=true \
  -replace='module.rosa[0].module.rosa-virt-machine-pool[0].rhcs_hcp_machine_pool.machine_pool'
```

Stop any virtual machines on the metal node first (see
[Replacing or removing the metal node](../openshift-virt#replacing-or-removing-the-metal-node)):
they cannot live-migrate here, so they block the node's drain and the old pool
never finishes deleting.

If the create half fails with `A NodePool with name ... is being deleted`, the
old node is still draining: wait until it has left `oc get nodes`, then run the
same apply again without `-replace`.

Note the outputs:
```bash
terraform output bgp_iam_role_arn
terraform output bgp_route_server_id
terraform output bgp_endpoint_ips
```

Wait for the router node:

```bash
oc get nodes -l bgp_router=true
```

## Step 2: Install the Operator

The bgp-cloud-connector operator is in the `redhat-operators` catalog. Its AWS
access uses OpenShift's token-based authentication: `ROLEARN` on the
Subscription makes the operator get short-lived credentials for the Terraform
IAM role from the Cloud Credential Operator, so no AWS keys are stored. Run
these from this folder (the Terraform output from the checkout that holds the
state):

```bash
ROLE_ARN=$(cd ../andys-demo-cluster-tf && terraform output -raw bgp_iam_role_arn)
sed "s#ROLE_ARN_REPLACE_ME#${ROLE_ARN}#" operator.yaml | oc apply -f -

until oc get csv -n openshift-bgp-cloud-connector 2>/dev/null | grep bgp-cloud-connector | grep -q Succeeded; do sleep 10; done
oc get pods -n openshift-bgp-cloud-connector
```

The Terraform IAM role trusts both the `openshift` and `sts.amazonaws.com`
audiences.

## Step 4: Apply BGP Configuration

Update `bgp-cloud-configuration.yaml` with your Route Server ID (from this
folder):

```bash
RS_ID=$(cd ../andys-demo-cluster-tf && terraform output -raw bgp_route_server_id)
sed "s/REPLACE_ME/$RS_ID/" bgp-cloud-configuration.yaml | oc apply -f -
```

Wait for it to go `Ready`. The `BGPRouting` CRs sit in `Pending` until it does:

```bash
oc wait bgpcloudconfiguration cluster --for=jsonpath='{.status.phase}'=Ready --timeout=300s
```

Then create the namespaces and the two networks:

```bash
oc apply -f namespace.yaml
oc apply -f bgp-routing.yaml
oc apply -f test-pod.yaml
```

Order matters: the namespaces must exist and be labelled **before** the
`BGPRouting` CRs, or they go `Degraded` with `NamespaceNotReady`. The
`k8s.ovn.org/primary-user-defined-network` label has to be set at namespace
creation: admission refuses to add it to a namespace that already exists.

Do **not** hand-write a `ClusterUserDefinedNetwork`. The operator creates one
per `BGPRouting`, named `cluster-udn-<name>`, and labels it `advertise: "true"`
so the shared `RouteAdvertisements` picks it up.

## Step 5: Install OpenShift Virtualization (optional)

To test BGP routing with VMs, install OpenShift Virtualization by following
[../openshift-virt](../openshift-virt), then create the two test VMs:

```bash
oc apply -f test-vm.yaml
oc wait vm/vm-red -n vms-red --for=condition=Ready --timeout=10m
oc wait vm/vm-blue -n vms-blue --for=condition=Ready --timeout=10m
```

The VMs use the `l2bridge` interface binding, which is required in a
primary-UDN namespace and is the default there. The `masquerade` binding
installs nftables rules in the virt-launcher pod that drop inbound traffic on
the UDN interface, so the VM is unreachable from outside even when BGP is
advertising its subnet correctly. `l2bridge` needs no `HyperConverged`
configuration.

## Step 6: Validate

Check operator status (all conditions should be True):
```bash
oc get bgpcloudconfiguration cluster -o jsonpath='{.status.conditions}' | jq .
oc get bgprouting
```

Both networks should report `Ready`, with one CUDN each and one shared
RouteAdvertisements between them:

```bash
oc get clusteruserdefinednetwork
oc get routeadvertisements
```

Check BGP peering. Both prefixes should be in the table:
```bash
FRR_POD=$(oc get pods -n openshift-frr-k8s -l app=frr-k8s -o name | head -1)
oc exec -n openshift-frr-k8s $FRR_POD -c frr -- vtysh -c "show bgp summary"
oc exec -n openshift-frr-k8s $FRR_POD -c frr -- vtysh -c "show ip bgp"
```

Verify routes in VPC route tables:
```bash
RS_ID=$(cd ../andys-demo-cluster-tf && terraform output -raw bgp_route_server_id)
VPC_ID=$(aws ec2 get-route-server-associations --region eu-west-2 --route-server-id "$RS_ID" \
  --query 'RouteServerAssociations[0].VpcId' --output text)
aws ec2 describe-route-tables --region eu-west-2 --filters "Name=vpc-id,Values=$VPC_ID" \
  --query 'RouteTables[*].Routes[?DestinationCidrBlock==`10.100.0.0/16` || DestinationCidrBlock==`10.101.0.0/16`]'
```

Each subnet route table lists both prefixes as `active` (the VPC's main route
table is not propagated and stays empty). A new Route Server peer takes a
minute or two to go from `pending` to `available` before routes appear.

Pods and VMs on a CUDN get two IPs:
- **CUDN (primary)**: 10.100.x.x / 10.101.x.x on `ovn-udn1`, directly routable from the VPC
- **Cluster (infrastructure)**: 10.131.x.x on `eth0`, marked `infrastructure-locked`, carries kubelet probe traffic only

```bash
oc get pod -n vms-red client-red -o jsonpath='{.metadata.annotations.k8s\.ovn\.org/pod-networks}' | jq .
oc get vmi -n vms-red vm-red -o jsonpath='{.status.interfaces}' | jq .
```

### Reachability

From an EC2 instance in the same VPC (not from cluster nodes, which route
through OVN), both VMs answer directly:

```bash
RED=$(oc get vmi -n vms-red vm-red -o jsonpath='{.status.interfaces[0].ipAddress}')
BLUE=$(oc get vmi -n vms-blue vm-blue -o jsonpath='{.status.interfaces[0].ipAddress}')

curl http://$RED      # red network  - CUDN cluster-udn-red  - 10.100.0.0/16
curl http://$BLUE     # blue network - CUDN cluster-udn-blue - 10.101.0.0/16
```

### Isolation

From inside the cluster, red cannot reach blue even though both subnets are in
the same VRF and both are learned back from the Route Server:

```bash
oc exec -n vms-red client-red -- curl -s --max-time 5 http://$RED    # succeeds
oc exec -n vms-red client-red -- curl -s --max-time 5 http://$BLUE   # times out
```

The packet egresses the cluster toward the provider network, and OVN drops it
on the way back in. This is the default (`strict`) advertised-UDN isolation
behaviour. Nothing in this demo configures it.

## Cleanup

```bash
oc delete -f test-vm.yaml -f test-pod.yaml -f bgp-routing.yaml -f namespace.yaml
oc delete bgpcloudconfiguration cluster
oc delete subscription bgp-cloud-connector -n openshift-bgp-cloud-connector
oc delete csv -n openshift-bgp-cloud-connector \
  "$(oc get csv -n openshift-bgp-cloud-connector -o name | grep bgp-cloud-connector | cut -d/ -f2)"
oc delete namespace openshift-bgp-cloud-connector
cd ../andys-demo-cluster-tf && terraform destroy -var-file=bgp_rosa.tfvars
```

Delete the `BGPRouting` CRs before the `BGPCloudConfiguration`: its finalizer
blocks deletion while routing CRs exist (`RoutingCRsExist`). Let the
`BGPCloudConfiguration` finish deleting before running Terraform: its finalizer
removes the Route Server peers and reverts the Network operator patch, and
Terraform cannot delete a Route Server that still has peers.

On ROSA, the operator's ClusterRoleBindings survive `oc delete`. They are named
`openshift-bgp-cloud-connector-*`, and the managed-cluster admission webhook
refuses to delete ClusterRoleBindings in the `openshift-` namespace prefix:

```
admission webhook "clusterrolebindings-validation.managed.openshift.io" denied
the request: Deleting ClusterRoleBinding openshift-bgp-cloud-connector-manager-
rolebinding is not allowed
```

Three are left behind. They are harmless (they reference a ServiceAccount that
no longer exists, and a reinstall simply updates them), but they cannot be
removed by a cluster admin.

## Notes

### Adding another network

Three things, and nothing else changes:

1. A namespace labelled `k8s.ovn.org/primary-user-defined-network: ""` and `cluster-udn: <name>` at creation.
2. A `BGPRouting` with a unique `spec.network.name` and a non-overlapping subnet.
3. Nothing: the shared `RouteAdvertisements` picks it up from the `advertise: "true"` label the operator applies.

`spec.network.name` uniqueness is enforced (`DuplicateNetwork`); subnet overlap
is not, so check it yourself against the other networks and the VPC CIDR.

### Isolation has a hole: services

The isolation ACLs cover pod and cluster-IP addresses. If a workload is exposed
through a LoadBalancer, NodePort or ExternalIP service, the other network *can*
reach it by that path. Don't expose these networks that way if the isolation
matters. `advertised-udn-isolation-mode: loose` relaxes the isolation
deliberately. Leave it alone.

### Primary UDN limits what you can do to a VM

On a primary UDN you cannot use `virtctl ssh`, `oc port-forward` to the VM, or
headless services. All three use the same path: they reach the VM through the
virt-launcher pod's default-cluster-network address, and on a primary UDN that
interface is `infrastructure-locked`: OVN ACLs permit only kubelet probe
traffic on it, and host-side nftables rules (chain `udn-isolation`) stop
non-kubelet host processes using it too. The guest lives on `ovn-udn1`, which
those tools never dial.

For this demo it barely matters: the UDN address is routable from the VPC, so
`ssh fedora@$RED` from a VPC host works. `virtctl console` also works, since it
goes over the serial path rather than the guest network.

### ROSA/public-cloud constraints

- Connecting VMs directly to the underlay network is **not supported on public clouds**. A secondary localnet CUDN (the usual way to put a VM on an existing VLAN) is therefore not an option on ROSA. Layer 2 overlay CUDNs advertised over BGP, which is what this demo does, are the supported shape.
- Using EVPN with BGP to extend layer 2 connectivity for primary cluster-scoped UDNs is likewise not supported on public clouds.
- The operator patches `Network.operator.openshift.io/cluster` to enable the FRR provider and route advertisements. On ROSA that CR is Red Hat–managed territory; treat the whole demo as a PoC on a throwaway cluster, not something to run on a cluster you care about the support status of.

### Other notes

- **Single router node**: This demo uses 1 m5.metal node. VPC Route Server installs only one active route per prefix in the FIB (no ECMP), so a single router works for demo purposes. For production, use 3 across AZs for failover.
- **Scale ceiling**: 100 routes per route server FIB, 100 per route server peer, and 100 propagated routes per route table. The last two are not adjustable. Layer2 CUDNs advertise one prefix each, so the ceiling is roughly 100 networks.
- **VRF names**: a CUDN of 15 characters or fewer gets a VRF of the same name; longer ones get a VRF named from the network ID. `cluster-udn-red` is 15, `cluster-udn-blue` is 16, so `vtysh -c "show ip route vrf cluster-udn-red"` works but blue's VRF needs looking up. Keep `spec.network.name` to 3 characters if you want both predictable.
- **Source/Dest Check**: The operator automatically disables source/destination checks on the router node's ENIs, using its IAM role.
- **Security Groups**: The metal node needs RFC1918 and allow-all security groups attached (via `additional_security_group_ids` on the machine pool, requires RHCS module >= 1.7.5). Without these, return traffic from CUDN IPs is blocked by the default cluster SG.
- **Testing from cluster nodes**: Pings from other cluster nodes go through OVN (not the VPC route table), so they're not a valid test of BGP routing. Use an EC2 instance in the same VPC instead.
- **Replicas quirk**: The RHCS provider reports `replicas` as the total compute across all pools. If terraform plan shows a replicas mismatch, use `terraform apply -refresh-only` targeting the cluster resource.
- Based on the [rosa-bgp PoC](https://github.com/rh-mobb/rosa-bgp) and [bgp-cloud-connector operator](https://github.com/openshift/bgp-cloud-connector).
