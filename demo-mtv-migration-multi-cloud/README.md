# Multi-Cloud VM Migration with MTV

This demo moves a running virtual machine from an on-premises OpenShift cluster
to Red Hat OpenShift Service on AWS (ROSA) with the Migration Toolkit for
Virtualization (MTV), live in front of an audience, in about three minutes. The
VM serves a web page that looks up the network it is running on at every boot,
so the page goes from "Running on premises" to "Running on AWS" once MTV has
copied its disk and started it on ROSA. It shows that VMs on OpenShift
Virtualization can move between a datacenter and a public cloud with the same
platform and the same tooling at both ends, and it is here as a ready-made,
repeatable version of that story.

Tested: 2026-11-09, on-premises OpenShift 4.22.12 on Hetzner (source) to ROSA HCP 4.22.12 (destination), OpenShift Virtualization 4.22.12 and MTV 2.12.10 on both: setup and a command-line migration (145 s, plus 24 s for the page). Reset and Clean Up not yet run; the console Start button not yet pressed by a person.

## How it works

```
ON PREMISES (source)                         ROSA (destination)
====================                         ==================
VM where-am-i  (mtv-demo)                    MTV: Provider "hetzner" -> Plan
  page: "Running on premises"                  |
  Route where-am-i  -> 503 after migration     |  1. reads the VM over the source API (6443)
                                               |  2. copies the disk from the source's
VirtualMachineExport  <------------------------+     VirtualMachineExport route (443)
                                               |  3. creates the VM in mtv-demo
                                             VM where-am-i
                                               page: "Running on AWS"
                                             Route where-am-i
```

This is a **cold migration**, the type MTV supports between OpenShift
clusters without extra networking: MTV stops the source VM, copies its disk
and starts it on ROSA. The source VM is stopped, not deleted. The VM is a
Fedora 45 image of about 580 MB in a 5 GiB disk, so the copy takes under two
minutes. The page comes from a script that cloud-init installs as a systemd
service, which runs at every boot and asks `ipinfo.io` who owns the VM's
public IP address: Hetzner on premises, Amazon on ROSA.

* `common/`: the `mtv-demo` namespace and the VM's Service and Route, applied
  on both clusters so the ROSA URL exists before the VM arrives.
* `source/`: the VM, its cloud-init Secret, and the ServiceAccount and
  ClusterRole that MTV on ROSA uses to read and export it.
* `destination/`: the MTV Provider for the source cluster, the network and
  storage maps, the Plan, and a Migration to start it from the command line.

## Prerequisites

* **Source:** an on-premises OpenShift 4.20 to 4.22 cluster whose workers
  offer KVM, with [OpenShift Virtualization](../openshift-virt) and
  [MTV](../mtv) installed. Its API and its `*.apps` routes must be reachable
  from ROSA, and the VM needs outbound internet access.
* **Destination:** a ROSA cluster with a bare-metal machine pool
  ([andys-demo-cluster-tf](../andys-demo-cluster-tf) with `virt_rosa.tfvars`),
  with [OpenShift Virtualization](../openshift-virt) and [MTV](../mtv)
  installed. Install OpenShift Virtualization before MTV, or MTV's `host`
  provider shows `ConnectionFailed` until it is (it recovers by itself).
* `oc` CLI with cluster-admin access on both clusters.

The commands below talk to both clusters at once, so point a variable at each
cluster's kubeconfig:

```bash
export KUBECONFIG_SOURCE=~/.kube/<on-prem-cluster>
export KUBECONFIG_DEST=~/.kube/<rosa-cluster>
```

## Setup

Run these from this folder. Setup takes about ten minutes and is done before
the talk.

### 1. Let CDI use the source cluster's storage

Skip this if the source cluster's default storage class has a storage profile
with access modes set (`oc get storageprofile <class> -o yaml` shows
`claimPropertySets`). An NFS provisioner that the Containerized Data Importer
(CDI) does not recognise has none, and VM disks then never bind:

```bash
oc --kubeconfig "$KUBECONFIG_SOURCE" patch storageprofile <storage-class> --type merge \
  -p '{"spec":{"claimPropertySets":[{"accessModes":["ReadWriteOnce"],"volumeMode":"Filesystem"}]}}'
```

The source's storage class name also goes into `destination/migration-setup.yaml`
(`StorageMap`, `managed-nfs-storage` as tested): change it there if yours
differs.

### 2. Create the VM on the source cluster

```bash
oc --kubeconfig "$KUBECONFIG_SOURCE" apply -f common/namespace.yaml -f common/web.yaml \
  -f source/cloud-init.yaml -f source/vm.yaml
oc --kubeconfig "$KUBECONFIG_SOURCE" wait vm/where-am-i -n mtv-demo --for=condition=Ready --timeout=15m
```

Open the page (it can take a minute after `Ready`):

```bash
echo "https://$(oc --kubeconfig "$KUBECONFIG_SOURCE" get route where-am-i -n mtv-demo -o jsonpath='{.spec.host}')"
```

It shows **Running on premises** and the source network's name.

### 3. Give MTV on ROSA access to the source cluster

The ServiceAccount, ClusterRole and binding go first: a token Secret created
before its ServiceAccount exists is deleted straight away.

```bash
oc --kubeconfig "$KUBECONFIG_SOURCE" apply -f source/mtv-access.yaml
oc --kubeconfig "$KUBECONFIG_SOURCE" apply -f source/mtv-token.yaml
```

MTV's documentation asks for a cluster-admin token on the source;
`mtv-migration-role` is narrower, and is what this demo was tested with. The
token still grants that role across the source cluster, so treat it as a
secret.

### 4. Prepare ROSA

The Service and Route go on ROSA too, so the URL is ready before the VM
arrives:

```bash
oc --kubeconfig "$KUBECONFIG_DEST" apply -f common/namespace.yaml -f common/web.yaml
echo "https://$(oc --kubeconfig "$KUBECONFIG_DEST" get route where-am-i -n mtv-demo -o jsonpath='{.spec.host}')"
```

That URL shows "Application is not available" until the migration finishes.

### 5. Register the source cluster in MTV

The Secret holds the source API URL, the token, and the source cluster's CA so
ROSA can verify its API certificate. The token goes straight from one cluster
to the other on a pipe, so it never appears on a command line:

```bash
SOURCE_API=$(oc --kubeconfig "$KUBECONFIG_SOURCE" whoami --show-server)
oc --kubeconfig "$KUBECONFIG_SOURCE" get secret mtv-token -n mtv-demo -o jsonpath='{.data.token}' | base64 -d \
  | oc --kubeconfig "$KUBECONFIG_DEST" create secret generic hetzner-source -n openshift-mtv \
      --from-file=token=/dev/stdin \
      --from-literal=url="$SOURCE_API" \
      --from-literal=insecureSkipVerify=false \
      --from-file=cacert=<(oc --kubeconfig "$KUBECONFIG_SOURCE" get configmap kube-root-ca.crt -n mtv-demo -o jsonpath='{.data.ca\.crt}')
oc --kubeconfig "$KUBECONFIG_DEST" label secret hetzner-source -n openshift-mtv \
  createdForProviderType=openshift createdForResourceType=providers
```

Then create the Provider, the maps and the Plan, with the source API URL put
into the Provider:

```bash
sed "s#REPLACE_ME_SOURCE_API_URL#$SOURCE_API#" destination/migration-setup.yaml \
  | oc --kubeconfig "$KUBECONFIG_DEST" apply -f -
oc --kubeconfig "$KUBECONFIG_DEST" wait provider/hetzner -n openshift-mtv --for=condition=Ready --timeout=5m
oc --kubeconfig "$KUBECONFIG_DEST" wait plan/where-am-i-to-rosa -n openshift-mtv --for=condition=Ready --timeout=5m
```

Both providers show `READY` `True`, and the Plan is `Ready`:

```bash
oc --kubeconfig "$KUBECONFIG_DEST" get provider,networkmap,storagemap,plan -n openshift-mtv
```

## Running the demo

Have three browser tabs open:

1. The source page from step 2 (**Running on premises**). It reloads itself
   every 5 seconds.
2. The ROSA page from step 4 ("Application is not available").
3. The ROSA console at **Migration for Virtualization > Migration plans**.

Then:

1. In the console, open the plan **where-am-i-to-rosa** and press **Start**,
   then confirm. From the command line, the same thing is:

   ```bash
   oc --kubeconfig "$KUBECONFIG_DEST" create -f destination/migration.yaml
   ```

2. Watch the plan's progress: **Initialize** (about 30 s, the source VM stops,
   and its page goes to "Application is not available"), **DiskTransfer**
   (about 2 minutes), **VirtualMachineCreation** (seconds).
3. Once the plan shows **Succeeded**, reload the ROSA tab. The page comes up
   about 30 seconds later: **Running on AWS**, with Amazon as the network and
   a new public IP and boot time.

From the command line:

```bash
oc --kubeconfig "$KUBECONFIG_DEST" wait plan/where-am-i-to-rosa -n openshift-mtv --for=condition=Succeeded --timeout=15m
oc --kubeconfig "$KUBECONFIG_DEST" wait vm/where-am-i -n mtv-demo --for=condition=Ready --timeout=10m
oc --kubeconfig "$KUBECONFIG_SOURCE" get vm where-am-i -n mtv-demo
```

The ROSA VM is `Running` and `Ready`, and the source VM is `Stopped`.

## Reset for another run

A Plan that has succeeded cannot be started again, so a rerun needs the
migrated VM removed from ROSA, a fresh Plan, and the source VM started. Archive
the Plan before deleting it: archiving is what removes MTV's temporary
resources, including the `VirtualMachineExport` on the source.

```bash
oc --kubeconfig "$KUBECONFIG_DEST" patch plan where-am-i-to-rosa -n openshift-mtv --type merge -p '{"spec":{"archived":true}}'
oc --kubeconfig "$KUBECONFIG_DEST" wait plan/where-am-i-to-rosa -n openshift-mtv --for=condition=Archived --timeout=5m
oc --kubeconfig "$KUBECONFIG_DEST" delete plan where-am-i-to-rosa -n openshift-mtv
oc --kubeconfig "$KUBECONFIG_DEST" delete vm where-am-i -n mtv-demo
oc --kubeconfig "$KUBECONFIG_DEST" delete secret where-am-i-cloudinit -n mtv-demo
oc --kubeconfig "$KUBECONFIG_SOURCE" patch vm where-am-i -n mtv-demo --type merge -p '{"spec":{"runStrategy":"Always"}}'
```

Deleting the ROSA VM also deletes its disk (MTV makes the VM the disk's
owner). Then re-create the Plan with the `sed ... | oc apply` command from step
5, and wait for the source page and the Plan to be ready again.

## Clean Up

Run the first five commands of the reset, then:

```bash
sed "s#REPLACE_ME_SOURCE_API_URL#unused#" destination/migration-setup.yaml \
  | oc --kubeconfig "$KUBECONFIG_DEST" delete -f - --ignore-not-found
oc --kubeconfig "$KUBECONFIG_DEST" delete secret hetzner-source -n openshift-mtv
oc --kubeconfig "$KUBECONFIG_DEST" delete -f common/namespace.yaml
oc --kubeconfig "$KUBECONFIG_SOURCE" delete -f source/mtv-token.yaml -f source/mtv-access.yaml
oc --kubeconfig "$KUBECONFIG_SOURCE" delete -f source/vm.yaml -f source/cloud-init.yaml
oc --kubeconfig "$KUBECONFIG_SOURCE" delete -f common/namespace.yaml
```

## Troubleshooting

**Provider `hetzner` is not Ready:** `oc get provider hetzner -n openshift-mtv
-o yaml` shows the condition. The source API must be reachable from ROSA on
port 6443, and the `cacert` must be the source cluster's CA.

**DiskTransfer stays at 0%:** the importer pod on ROSA must reach the source
cluster's `*.apps` routes on port 443 (it downloads from the
`VirtualMachineExport` route). Check the importer pod's log in `mtv-demo`.

**The ROSA page says "Running somewhere new":** `ipinfo.io` named a network
that is neither Amazon nor Hetzner, so the page shows its name instead. If it
shows `unknown`, the VM could not reach `ipinfo.io`.

## Related Demos

* [Cross-cluster live migration](../demo-cross-cluster-live-migration/): the
  same two clusters with a stretched Layer 2 network, so the VM keeps its IP.
* [Deploying a VM with OpenShift Virtualization](../demo-deploying-a-vm-with-openshift-virt/)
