# Stretched Layer 2 — Cluster to Cluster

Connect two OpenShift clusters at Layer 2 so VMs on both clusters share the
same broadcast domain. Uses OpenVPN TAP + VXLAN architecture — both endpoints
are OpenShift clusters.

## Architecture

Both clusters run the same Hub & Spoke topology. The Hubs connect to each other via OpenVPN TAP, creating a single shared L2 broadcast domain across clusters.

```
  CLUSTER A (VPN Server)              CLUSTER B (VPN Client)
  On-prem / Self-managed              ROSA HCP

  ┌─────────────────────┐             ┌─────────────────────┐
  │      HUB POD        │   OpenVPN   │      HUB POD        │
  │  br-hub (.1)        ◄═════════════►  br-hub (.10)       │
  │  tap0 + vxlan-hub   │  UDP 1194   │  tap0 + vxlan-hub   │
  └──────────┬──────────┘             └──────────┬──────────┘
             │ VXLAN                              │ VXLAN
        ┌────┴────┐                          ┌────┴────┐
        │         │                          │         │
  ┌─────┴───┐ ┌───┴─────┐             ┌─────┴───┐ ┌───┴─────┐
  │Spoke Pod│ │Spoke Pod│             │Spoke Pod│ │Spoke Pod│
  │br-spoke │ │br-spoke │             │br-spoke │ │br-spoke │
  └────┬────┘ └─────────┘             └────┬────┘ └─────────┘
       │                                    │
  ┌────┴─────┐                        ┌────┴─────┐
  │  VM .51  │                        │  VM .52  │
  └──────────┘                        └──────────┘

  Data path:
  VM .52 → br-spoke → VXLAN → br-hub → VPN → br-hub → VXLAN → br-spoke → VM .51
```

## ROSA HCP / OVN-Kubernetes Limitation

**hostNetwork pods behind LoadBalancer or NodePort services do not work
reliably on ROSA HCP (OVN-Kubernetes).** Cross-node DNAT fails because
hostNetwork traffic bypasses the Geneve overlay tunnels that OVN-K uses for
pod-to-pod communication. This means you **cannot run the VPN server on ROSA
HCP** — the inbound connection will never reach the pod.

The workaround is to make ROSA HCP the **VPN client** (outbound-only, no
Service needed). The on-prem or self-managed cluster runs the VPN server.

## IP Assignments

| Device | IP |
|---|---|
| Cluster A hub bridge | 192.168.100.1 |
| Cluster B hub bridge | 192.168.100.10 |
| VM on Cluster A | 192.168.100.51 |
| VM on Cluster B | 192.168.100.52 |

## Setup

### 1. Generate PKI (run once, from anywhere)

```bash
bash generate-pki.sh
```

### 2. Label nodes on BOTH clusters

```bash
# On each cluster:
oc label node <hub-node> industrial-role=hub
oc label node <spoke-node-1> industrial-role=spoke
oc label node <spoke-node-2> industrial-role=spoke
```

### 3. Deploy common resources (on BOTH clusters)

```bash
oc apply -f common/namespace.yaml
oc apply -f common/serviceaccount.yaml
oc apply -f common/rolebinding.yaml
oc apply -f common/image-build.yaml
# Wait for the build to complete:
oc logs -f bc/industrial-networking-build -n industrial-network
```

### 4. Deploy Cluster A (VPN server)

```bash
# Switch to Cluster A context
oc create secret generic vpn-server-auth \
  --from-file=ca.crt=pki/ca.crt \
  --from-file=server.crt=pki/server.crt \
  --from-file=server.key=pki/server.key \
  --from-file=dh.pem=pki/dh.pem \
  -n industrial-network

oc apply -f cluster-a-server/vpn-server-secret.yaml
oc apply -f cluster-a-server/vpn-server-hub.yaml
oc apply -f common/spoke-daemonset.yaml
```

The hub pod uses `hostNetwork: true`, so OpenVPN listens directly on the
node's IP at port 1194/UDP. No Kubernetes Service is needed — you expose
this port externally depending on your platform (see next section).

### 5. Expose the VPN server externally

The hub pod listens on UDP 1194 on the host network. How you expose this to
the internet depends on where Cluster A runs:

**On-prem (with a public IP on the host or a gateway)**

If your hub node is behind a gateway or hypervisor, use iptables DNAT to
forward traffic from the public IP to the hub node's internal IP:

```bash
# On the gateway / hypervisor host:
iptables -t nat -A PREROUTING -d <PUBLIC_IP> -p udp --dport 1194 \
  -j DNAT --to-destination <HUB_NODE_IP>:1194
iptables -t nat -A POSTROUTING -d <HUB_NODE_IP> -p udp --dport 1194 \
  -j MASQUERADE
```

See the [On-Prem Firewall Setup](#on-prem-firewall-setup) section below for
the full set of firewall rules needed on a bare-metal host.

**Self-managed OpenShift on AWS (non-HCP)**

You can create an NLB targeting the hub node:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: industrial-hub-vpn
  namespace: industrial-network
  annotations:
    service.beta.kubernetes.io/aws-load-balancer-type: "nlb"
    service.beta.kubernetes.io/aws-load-balancer-scheme: "internet-facing"
spec:
  selector:
    app: industrial-hub
  ports:
    - name: openvpn
      protocol: UDP
      port: 1194
      targetPort: 1194
  type: LoadBalancer
```

**ROSA HCP — do NOT run the VPN server here.** See the limitation above.
Use ROSA HCP as Cluster B (client) instead.

### 6. Deploy Cluster B (VPN client)

```bash
# Switch to Cluster B context

# Edit vpn-client-secret.yaml: set 'remote' to Cluster A's public IP / LB address
oc create secret generic vpn-client-auth \
  --from-file=ca.crt=pki/ca.crt \
  --from-file=client.crt=pki/client.crt \
  --from-file=client.key=pki/client.key \
  -n industrial-network

oc apply -f cluster-b-client/vpn-client-secret.yaml
oc apply -f cluster-b-client/vpn-client-hub.yaml
oc apply -f common/spoke-daemonset.yaml
```

No Service or external exposure is needed on the client side — OpenVPN
connects outbound to the server.

### 7. Deploy test VMs (on both clusters)

```bash
# On BOTH clusters:
oc apply -f vm-test/namespace.yaml
oc apply -f vm-test/network-attachment-definition.yaml

# On Cluster A:
oc apply -f vm-test/linux-vm-cluster-a.yaml

# On Cluster B:
oc apply -f vm-test/linux-vm-cluster-b.yaml
```

### 8. Disable Source/Dest Check (AWS only)

If either cluster runs on AWS, disable the source/dest check on all worker
nodes in the EC2 console.

## On-Prem Firewall Setup

When running Cluster A on a bare-metal server with OpenShift inside KVM VMs,
the following firewall configuration is needed on the **host** to allow
inbound VPN traffic to reach the OpenShift hub node.

### 1. Open UDP 1194 in firewalld

```bash
firewall-cmd --add-port=1194/udp --permanent
firewall-cmd --reload
```

**Important:** Check `firewall-cmd --list-protocols`. If it shows `tcp`, that
means firewalld is filtering by protocol and will block **all UDP** regardless
of port rules. Remove it:

```bash
firewall-cmd --remove-protocol=tcp --permanent
firewall-cmd --reload
```

### 2. Enable masquerade

```bash
firewall-cmd --add-masquerade --permanent
firewall-cmd --reload
```

### 3. Add iptables DNAT rules

Forward traffic from the server's public IP to the OpenShift node running the
hub pod:

```bash
iptables -t nat -A PREROUTING -d <SERVER_PUBLIC_IP> -p udp --dport 1194 \
  -j DNAT --to-destination <HUB_NODE_IP>:1194
iptables -t nat -A POSTROUTING -d <HUB_NODE_IP> -p udp --dport 1194 \
  -j MASQUERADE
```

### 4. Allow traffic through libvirt's forward chain

If the OpenShift nodes run as libvirt/KVM VMs, the `LIBVIRT_FWI` (forward-in)
chain rejects new connections by default. Add an accept rule **before** the
reject:

```bash
# Find the REJECT rule position:
iptables -L LIBVIRT_FWI --line-numbers -n

# Insert an ACCEPT rule before it (adjust position as needed):
iptables -I LIBVIRT_FWI 2 -o <VM_BRIDGE> -d <HUB_NODE_IP> -p udp --dport 1194 -j ACCEPT
```

Example for a node at 192.168.50.13 on bridge virbr1:

```bash
iptables -I LIBVIRT_FWI 2 -o virbr1 -d 192.168.50.13 -p udp --dport 1194 -j ACCEPT
```

### 5. Lock down source IPs (optional)

Once working, restrict the DNAT rules to only allow traffic from the remote
cluster's NAT gateway IPs:

```bash
# Find the NAT gateway IPs (for ROSA, check the VPC NAT gateways in the AWS console)
iptables -t nat -R PREROUTING <rule-num> -s <NAT_GW_IP_1>,<NAT_GW_IP_2>,<NAT_GW_IP_3> \
  -d <SERVER_PUBLIC_IP> -p udp --dport 1194 -j DNAT --to-destination <HUB_NODE_IP>:1194
```

### Making iptables rules persistent

The iptables rules above are lost on reboot. To persist them:

```bash
dnf install iptables-services
iptables-save > /etc/sysconfig/iptables
systemctl enable iptables
```

## Validation

```bash
# 1. VPN tunnel (on Cluster B — client)
oc logs deployment/industrial-hub -n industrial-network | grep "Initialization Sequence Completed"

# 2. Hub-to-hub ping (Cluster B hub → Cluster A hub)
oc exec -n industrial-network deployment/industrial-hub -- ping -c3 192.168.100.1

# 3. Cross-cluster VM ping (from Cluster B VM → Cluster A VM)
virtctl console workstation-cluster-b -n industrial-spoke
# Inside VM: ping 192.168.100.51

# 4. Reverse direction (from Cluster A VM → Cluster B VM)
virtctl console workstation-cluster-a -n industrial-spoke
# Inside VM: ping 192.168.100.52
```

## Connecting a pod to the L2 bridge

You don't need a VM to use the stretched L2 network. Any pod on a spoke
node can join the bridge using a Multus NetworkAttachmentDefinition.

### 1. Create the NAD (if not already done)

```bash
oc apply -f vm-test/network-attachment-definition.yaml
```

This creates a bridge CNI attachment called `industrial-bridge-network` that
connects to `br-spoke`.

### 2. Add the annotation to your pod

Add a Multus annotation and a static IP in the 192.168.100.0/24 range:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: l2-test
  namespace: industrial-spoke
  annotations:
    k8s.v1.cni.cncf.io/networks: |
      [{"name": "industrial-bridge-network",
        "ips": ["192.168.100.61/24"]}]
spec:
  nodeSelector:
    industrial-role: spoke
  containers:
  - name: tools
    image: registry.access.redhat.com/ubi9/ubi-minimal:latest
    command: ["sleep", "infinity"]
```

The pod gets a secondary interface (`net1`) on `br-spoke` with the specified
IP. It can reach any other device on the 192.168.100.0/24 network across
both clusters.

### 3. Test connectivity

```bash
oc exec -n industrial-spoke l2-test -- curl -s http://192.168.100.52
```

**Important:** The pod must run on a node labeled `industrial-role: spoke`
where the spoke DaemonSet has created `br-spoke`. If the bridge doesn't
exist, the pod will fail to start.

## Security considerations

### hostNetwork and privileged pods

The hub and spoke pods use `hostNetwork: true` and `privileged: true`:

- **Full host network access** — the pod shares the node's network
  namespace. It can see all host interfaces, bind any port, and observe
  traffic on the node. Network Policies do not apply.
- **Privileged escalation** — the pod can modify kernel parameters
  (rp_filter, ip_forward), create/delete network interfaces, and
  manipulate iptables rules on the node.
- **Blast radius** — a compromised hub or spoke pod has root-level network
  access to the node and can intercept or inject traffic on the L2 bridge.

### Mitigations

- Run hub and spoke pods in a dedicated namespace with strict RBAC.
- Use a dedicated service account (`industrial-admin`) with only the
  permissions it needs (pod list for FDB discovery).
- Restrict which nodes can run these pods using `nodeSelector` labels —
  only label nodes that need L2 connectivity.
- Use OpenVPN `tls-crypt` for additional tunnel security.
- On the VPN server, restrict inbound source IPs to the client cluster's
  NAT gateway addresses.

### L2 bridge exposure

Any pod or VM attached to `br-spoke` via Multus has direct L2 access to the
entire stretched network, including devices on the remote cluster. There is
no network policy enforcement on bridge traffic — isolation relies on which
pods/VMs are allowed to use the NetworkAttachmentDefinition.

## Notes

- The OpenVPN `server-bridge` directive assigns IPs from the 192.168.100.10-20
  range to connecting clients, so Cluster B's hub gets 192.168.100.10
  automatically
- Both hubs run FDB discovery loops every 30s to find their local spoke
  nodes and remove stale entries for nodes that no longer run spokes
- The hub scripts automatically clean up stale interfaces (tap0, br-hub,
  vxlan-hub) from previous hostNetwork runs and strip the IP that OpenVPN
  assigns to tap0 (since tap0 is a bridge slave, its IP conflicts with
  br-hub routing)
- Hub deployments use `strategy: type: Recreate` because hostNetwork pods
  bind port 1194 directly — a RollingUpdate would fail with "Address already
  in use" when the new pod starts before the old one terminates
- OpenVPN runs in the foreground (not with `--daemon`) because daemonized
  OpenVPN silently exits in containers
- For production use, consider adding tls-crypt to the OpenVPN config for
  additional security
- MTU should be set to 1350 on the VM secondary NICs to account for
  double encapsulation (VXLAN + OpenVPN)
