# Cross-Cluster VM Migration with MTV

Bidirectional VM migration between an on-prem OpenShift cluster and
ROSA HCP using MTV (Migration Toolkit for Virtualization). The VM keeps its
IP address after migration thanks to the stretched L2 network — clients
can reach it at the same address regardless of which cluster hosts it.

This is a **warm migration** (cold switchover): MTV copies the disk while the
VM runs, then stops the source VM and recreates it on the destination. There
is a brief downtime window during the switchover. True zero-downtime live
migration (memory transfer while running) is a KubeVirt roadmap item for
cross-cluster scenarios.

Builds on the [Stretched L2 demo](../demo-stretched-layer2-onto-rosa/cluster-to-cluster/)
which provides the Layer 2 network both clusters share.

## Architecture

```
CLUSTER A (on-prem)                         CLUSTER B (ROSA HCP)
==========================                 ==========================

[ OpenShift Virtualization ]               [ OpenShift Virtualization ]
[ MTV (Forklift) ]                         [ MTV (Forklift) ]

[ VM: cclm-test-vm ]  ----migrate-------> [ VM: cclm-test-vm ]
  192.168.100.60                             192.168.100.60
       |                                          |
    br-spoke                                   br-spoke
       |                                          |
    vxlan-spoke                               vxlan-spoke
       |                                          |
    br-hub <=== OpenVPN TAP (L2 tunnel) ===> br-hub
```

The stretched L2 network ensures the VM retains its IP address after
migration. MTV orchestrates the disk transfer and VM recreation.

### Test Results

| Metric | Value |
|---|---|
| Disk size | 10.8 GB (Fedora cloud image) |
| Transfer speed | ~58 MB/s |
| Total migration time | ~3.5 minutes |
| Downtime | Brief (VM stop + recreate) |
| IP preserved | Yes (192.168.100.60) |

## Prerequisites

- Two OpenShift 4.20+ clusters (tested on 4.22)
- **Deploy the [cluster-to-cluster stretched L2 demo](../demo-stretched-layer2-onto-rosa/cluster-to-cluster/)
  first** — it creates the L2 network, namespaces (`industrial-network`,
  `industrial-spoke`), spoke DaemonSets, NADs, and node labels that this
  demo depends on. Verify hub-to-hub ping works before continuing.
- `oc` CLI with cluster-admin on both clusters
- Bare-metal worker nodes on both clusters (required for OpenShift Virtualization)
- Spoke nodes labeled `industrial-role=spoke` with `br-spoke` bridge active
- AWS CLI configured (for disabling source/dest check on ROSA nodes)

Set up kubeconfig variables for the instructions below:

```bash
export KUBECONFIG_HETZNER=~/.secrets/hetzner-kubeconfig
export KUBECONFIG_ROSA=~/.secrets/rosa-kubeconfig  # or your default context
```

### Disable source/dest check (AWS only)

ROSA nodes need source/dest check disabled for the VXLAN L2 traffic:

```bash
for INSTANCE_ID in $(oc get nodes -o jsonpath='{range .items[*]}{.spec.providerID}{"\n"}{end}' | grep -oP 'i-[a-z0-9]+'); do
  aws ec2 modify-instance-attribute --instance-id $INSTANCE_ID --no-source-dest-check --region <REGION>
done
```

### Configure StorageProfile (NFS provisioners)

If the on-prem cluster uses an NFS provisioner that CDI doesn't recognize,
configure the StorageProfile so DataVolumes get the correct access mode:

```bash
KUBECONFIG=$KUBECONFIG_HETZNER oc patch storageprofile managed-nfs-storage --type merge \
  -p '{"spec":{"claimPropertySets":[{"accessModes":["ReadWriteOnce"],"volumeMode":"Filesystem"}]}}'
```

## Part A: Install OpenShift Virtualization on the on-prem cluster

ROSA already has OpenShift Virtualization installed. The on-prem cluster
needs it too.

```bash
# On the on-prem cluster:
KUBECONFIG=$KUBECONFIG_HETZNER oc apply -f prereqs/cnv-namespace.yaml
KUBECONFIG=$KUBECONFIG_HETZNER oc apply -f prereqs/cnv-operatorgroup.yaml
KUBECONFIG=$KUBECONFIG_HETZNER oc apply -f prereqs/cnv-subscription.yaml

# Wait for the operator to install:
KUBECONFIG=$KUBECONFIG_HETZNER oc get csv -n openshift-cnv -w

# Once the CSV shows Succeeded, create the HyperConverged CR with the
# CCLM feature gate enabled:
KUBECONFIG=$KUBECONFIG_HETZNER oc apply -f prereqs/hyperconverged-cclm.yaml
```

## Part B: Enable CCLM feature gate on ROSA

ROSA already has a HyperConverged CR — patch it to enable the
`decentralizedLiveMigration` feature gate:

```bash
oc patch hyperconverged kubevirt-hyperconverged -n openshift-cnv --type merge \
  -p '{"spec":{"featureGates":{"decentralizedLiveMigration":true}}}'
```

## Part C: Install MTV on both clusters

```bash
# On BOTH clusters:
for KUBECONFIG in $KUBECONFIG_HETZNER $KUBECONFIG_ROSA; do
  KUBECONFIG=$KUBECONFIG oc apply -f prereqs/mtv-namespace.yaml
  KUBECONFIG=$KUBECONFIG oc apply -f prereqs/mtv-operatorgroup.yaml
  KUBECONFIG=$KUBECONFIG oc apply -f prereqs/mtv-subscription.yaml
done

# Wait for the MTV operator CSV to show Succeeded on both clusters:
KUBECONFIG=$KUBECONFIG_HETZNER oc get csv -n openshift-mtv -w
oc get csv -n openshift-mtv -w

# Create the ForkliftController with CCLM enabled on BOTH clusters:
for KUBECONFIG in $KUBECONFIG_HETZNER $KUBECONFIG_ROSA; do
  KUBECONFIG=$KUBECONFIG oc apply -f prereqs/forklift-controller-cclm.yaml
done
```

## Part D: Create service accounts on both clusters

MTV needs a service account on each cluster to authenticate from the
remote side.

```bash
# On BOTH clusters:
for KUBECONFIG in $KUBECONFIG_HETZNER $KUBECONFIG_ROSA; do
  KUBECONFIG=$KUBECONFIG oc apply -f source-setup/sa.yaml
  KUBECONFIG=$KUBECONFIG oc apply -f source-setup/sa-token.yaml
  KUBECONFIG=$KUBECONFIG oc apply -f source-setup/role.yaml
  KUBECONFIG=$KUBECONFIG oc apply -f source-setup/rolebinding.yaml
done
```

Extract the tokens:

```bash
# From the on-prem cluster:
HETZNER_TOKEN=$(KUBECONFIG=$KUBECONFIG_HETZNER bash scripts/extract-token.sh)
HETZNER_API=$(KUBECONFIG=$KUBECONFIG_HETZNER oc whoami --show-server)

# From ROSA:
ROSA_TOKEN=$(bash scripts/extract-token.sh)
ROSA_API=$(oc whoami --show-server)
```

## Part E: Deploy the test VM on the on-prem cluster

The `industrial-spoke` namespace and `industrial-bridge-network` NAD
already exist from the stretched L2 demo. Just deploy the VM:

```bash
KUBECONFIG=$KUBECONFIG_HETZNER oc apply -f vm/test-vm.yaml

# Wait for the DataVolume to import and VM to start:
KUBECONFIG=$KUBECONFIG_HETZNER oc get datavolume -n industrial-spoke -w
KUBECONFIG=$KUBECONFIG_HETZNER oc get vmi -n industrial-spoke -w
```

Verify the VM is reachable on the L2 network from ROSA:

```bash
# From a spoke pod on ROSA:
oc exec -n industrial-network deployment/industrial-hub -- \
  ping -c3 192.168.100.60
```

## Part F: Configure MTV providers

Create provider secrets and apply the Provider, NetworkMap, StorageMap,
and Plan resources.

### Get NAD UIDs for NetworkMaps

MTV references Multus networks by their Kubernetes UID. Get the UIDs
before applying the NetworkMap YAMLs:

```bash
HETZNER_NAD_UID=$(KUBECONFIG=$KUBECONFIG_HETZNER oc get net-attach-def \
  industrial-bridge-network -n industrial-spoke -o jsonpath='{.metadata.uid}')
ROSA_NAD_UID=$(oc get net-attach-def \
  industrial-bridge-network -n industrial-spoke -o jsonpath='{.metadata.uid}')

echo "Hetzner NAD UID: $HETZNER_NAD_UID"
echo "ROSA NAD UID: $ROSA_NAD_UID"
```

### Extract the on-prem cluster CA (self-signed clusters)

If the on-prem cluster uses a self-signed CA (common for bare-metal
installs), extract it for the provider secret:

```bash
KUBECONFIG=$KUBECONFIG_HETZNER oc config view --raw \
  -o jsonpath='{.clusters[0].cluster.certificate-authority-data}' \
  | base64 --decode > /tmp/hetzner-ca.crt
```

### Forward migration (on-prem → ROSA)

Applied on the **ROSA** cluster (the destination):

```bash
# Create the provider secret for the on-prem cluster (with CA cert):
bash scripts/create-provider-secret.sh \
  hetzner-provider-secret "$HETZNER_API" "$HETZNER_TOKEN" /tmp/hetzner-ca.crt

# Edit provider-hetzner.yaml: replace REPLACE_ME_HETZNER_API_URL with
# the value of $HETZNER_API, then apply:
oc apply -f migration/provider-hetzner.yaml

# Edit networkmap-hetzner-to-rosa.yaml: replace REPLACE_ME_SOURCE_NAD_UID
# with the value of $HETZNER_NAD_UID, then apply:
oc apply -f migration/networkmap-hetzner-to-rosa.yaml
oc apply -f migration/storagemap-hetzner-to-rosa.yaml
oc apply -f migration/plan-hetzner-to-rosa.yaml
```

### Reverse migration (ROSA → on-prem)

Applied on the **on-prem** cluster (the destination for the return trip):

```bash
# Create the provider secret for ROSA:
KUBECONFIG=$KUBECONFIG_HETZNER bash scripts/create-provider-secret.sh \
  rosa-provider-secret "$ROSA_API" "$ROSA_TOKEN"

# Edit provider-rosa.yaml: replace REPLACE_ME_ROSA_API_URL with
# the value of $ROSA_API, then apply:
KUBECONFIG=$KUBECONFIG_HETZNER oc apply -f migration/provider-rosa.yaml

# Edit networkmap-rosa-to-hetzner.yaml: replace REPLACE_ME_SOURCE_NAD_UID
# with the value of $ROSA_NAD_UID, then apply:
KUBECONFIG=$KUBECONFIG_HETZNER oc apply -f migration/networkmap-rosa-to-hetzner.yaml
KUBECONFIG=$KUBECONFIG_HETZNER oc apply -f migration/storagemap-rosa-to-hetzner.yaml
KUBECONFIG=$KUBECONFIG_HETZNER oc apply -f migration/plan-rosa-to-hetzner.yaml
```

## Part G: Migrate on-prem → ROSA

Start a continuous ping in a separate terminal to observe the switchover:

```bash
# From a ROSA spoke pod:
oc exec -n industrial-network deployment/industrial-hub -- \
  ping 192.168.100.60
```

Trigger the migration:

```bash
oc apply -f migration/migration-hetzner-to-rosa.yaml

# Monitor progress:
oc get migration -n openshift-mtv -w
```

Once complete, verify the VM is now running on ROSA:

```bash
oc get vmi -n industrial-spoke -o wide
# The VM should show a ROSA node in the NODENAME column

# The continuous ping should resume after the brief switchover
```

**Important:** MTV does not automatically delete the source VM after
migration — it leaves a stopped VM object on the source cluster. You must
delete it before attempting a reverse migration:

```bash
KUBECONFIG=$KUBECONFIG_HETZNER oc delete vm cclm-test-vm -n industrial-spoke --ignore-not-found
KUBECONFIG=$KUBECONFIG_HETZNER oc delete datavolume cclm-test-vm-rootdisk -n industrial-spoke --ignore-not-found
KUBECONFIG=$KUBECONFIG_HETZNER oc delete pvc cclm-test-vm-rootdisk -n industrial-spoke --ignore-not-found
```

## Part H: Migrate ROSA → on-prem

Migrate the VM back:

```bash
KUBECONFIG=$KUBECONFIG_HETZNER oc apply -f migration/migration-rosa-to-hetzner.yaml

# Monitor:
KUBECONFIG=$KUBECONFIG_HETZNER oc get migration -n openshift-mtv -w
```

Verify the VM is back on the on-prem cluster:

```bash
KUBECONFIG=$KUBECONFIG_HETZNER oc get vmi -n industrial-spoke -o wide
```

After the reverse migration, clean up the stopped source VM on ROSA:

```bash
oc delete vm cclm-test-vm -n industrial-spoke --ignore-not-found
oc delete datavolume cclm-test-vm-rootdisk -n industrial-spoke --ignore-not-found
oc delete pvc cclm-test-vm-rootdisk -n industrial-spoke --ignore-not-found
```

## Clean Up

```bash
# Delete migrations and plans on ROSA:
oc delete migration cclm-forward -n openshift-mtv --ignore-not-found
oc delete plan cclm-hetzner-to-rosa -n openshift-mtv --ignore-not-found
oc delete storagemap cclm-storagemap-hetzner-to-rosa -n openshift-mtv --ignore-not-found
oc delete networkmap cclm-netmap-hetzner-to-rosa -n openshift-mtv --ignore-not-found
oc delete provider hetzner-cluster -n openshift-mtv --ignore-not-found
oc delete secret hetzner-provider-secret -n openshift-mtv --ignore-not-found

# Delete migrations and plans on on-prem:
KUBECONFIG=$KUBECONFIG_HETZNER oc delete migration cclm-reverse -n openshift-mtv --ignore-not-found
KUBECONFIG=$KUBECONFIG_HETZNER oc delete plan cclm-rosa-to-hetzner -n openshift-mtv --ignore-not-found
KUBECONFIG=$KUBECONFIG_HETZNER oc delete storagemap cclm-storagemap-rosa-to-hetzner -n openshift-mtv --ignore-not-found
KUBECONFIG=$KUBECONFIG_HETZNER oc delete networkmap cclm-netmap-rosa-to-hetzner -n openshift-mtv --ignore-not-found
KUBECONFIG=$KUBECONFIG_HETZNER oc delete provider rosa-cluster -n openshift-mtv --ignore-not-found
KUBECONFIG=$KUBECONFIG_HETZNER oc delete secret rosa-provider-secret -n openshift-mtv --ignore-not-found

# Delete service accounts and RBAC on both clusters:
for KUBECONFIG in $KUBECONFIG_HETZNER $KUBECONFIG_ROSA; do
  KUBECONFIG=$KUBECONFIG oc delete clusterrolebinding mtv-cclm-binding --ignore-not-found
  KUBECONFIG=$KUBECONFIG oc delete clusterrole mtv-cclm-role --ignore-not-found
  KUBECONFIG=$KUBECONFIG oc delete secret mtv-cclm-token -n openshift-mtv --ignore-not-found
  KUBECONFIG=$KUBECONFIG oc delete sa mtv-cclm -n openshift-mtv --ignore-not-found
done

# Delete the test VM (wherever it currently lives):
KUBECONFIG=$KUBECONFIG_HETZNER oc delete vm cclm-test-vm -n industrial-spoke --ignore-not-found
oc delete vm cclm-test-vm -n industrial-spoke --ignore-not-found
KUBECONFIG=$KUBECONFIG_HETZNER oc delete datavolume cclm-test-vm-rootdisk -n industrial-spoke --ignore-not-found
oc delete datavolume cclm-test-vm-rootdisk -n industrial-spoke --ignore-not-found

# Optionally remove MTV and CNV operators (they may be used by other demos)
```

## Troubleshooting

**Migration plan shows "Not Ready"**

Check the Provider status — it must show `Ready`:
```bash
oc get provider -n openshift-mtv -o wide
```
If not ready, verify the SA token is valid and the API URL is reachable
from the destination cluster. For self-signed clusters, ensure the CA cert
is included in the provider secret (`--from-file=cacert=...`).

**"VM has unmapped networks"**

The NetworkMap source entries must reference the NAD by its Kubernetes UID
(not by name/path). Get the UID with:
```bash
oc get net-attach-def industrial-bridge-network -n industrial-spoke \
  -o jsonpath='{.metadata.uid}'
```
Replace `REPLACE_ME_SOURCE_NAD_UID` in the NetworkMap YAML with this value.
The source entry also needs `name`, `namespace`, and `type` fields alongside
the `id`.

**"Target VM already exists"**

MTV does not delete the source VM after migration. Delete the stopped VM
on the destination cluster before running the reverse migration:
```bash
oc delete vm cclm-test-vm -n industrial-spoke --ignore-not-found
oc delete datavolume cclm-test-vm-rootdisk -n industrial-spoke --ignore-not-found
```

**DataVolume stuck with no phase**

The StorageProfile for the destination storage class may be missing
`accessModes`. Check and patch it:
```bash
oc get storageprofile <storage-class> -o yaml
oc patch storageprofile <storage-class> --type merge \
  -p '{"spec":{"claimPropertySets":[{"accessModes":["ReadWriteOnce"],"volumeMode":"Filesystem"}]}}'
```

**Migration fails with "network not found"**

The NAD `industrial-bridge-network` must exist in `industrial-spoke` on
**both** clusters with the same name. Verify:
```bash
oc get net-attach-def -n industrial-spoke
KUBECONFIG=$KUBECONFIG_HETZNER oc get net-attach-def -n industrial-spoke
```

**VM loses IP after migration**

The cloud-init `write_files` with the NetworkManager connection file runs
only on first boot. If the interface name changes on the destination
cluster, the connection won't activate. Check `enp2s0` exists inside the
VM after migration.

**Slow migration over WAN**

Disk transfer goes through the MTV data channel (not the OpenVPN tunnel).
In testing, a 10.8 GB disk transferred at ~58 MB/s between Hetzner and
AWS eu-west-2, completing in ~3.5 minutes. Larger disks will take
proportionally longer.

## Related Demos

- [Stretched L2 onto ROSA](../demo-stretched-layer2-onto-rosa/) — the L2 network foundation
- [Multi-Cloud VM Migration with MTV](../demo-mtv-migration-multi-cloud/) — cold migration between clusters
- [OpenShift Virtualization on ROSA](../demo-openshift-virt-on-rosa/)
