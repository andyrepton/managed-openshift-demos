# Multi-Cloud VM Migration with MTV

This demo moves a running virtual machine from an on-premises OpenShift cluster
to Red Hat OpenShift Service on AWS (ROSA) with the Migration Toolkit for
Virtualization (MTV), live in front of an audience, in about two minutes. The VM serves a web page that works out which network it is running
on, and keeps a phrase from the audience on its own disk: after the migration
the page says "Running on AWS" instead of "Running on premises", and still
shows the same phrase, which proves the VM and its data came across. It shows
that VMs on OpenShift Virtualization can move between a datacenter and a public
cloud with the same platform and the same tooling at both ends, and it is here
as a ready-made, repeatable version of that story.

Tested: 2026-11-09, on-premises OpenShift 4.22.12 on Hetzner (source) to ROSA HCP 4.22.12 (destination), OpenShift Virtualization 4.22.12 and MTV 2.12.10 on both: every setup step, the warm-up, a command-line migration (122 s from start to the ROSA page, phrase carried across) and the reset. Clean Up was run by hand in an equivalent form, not as written; the console Start button was not pressed by a person.

## How it works

```
ON PREMISES (source)                         ROSA (destination)
====================                         ==================
VM where-am-i  (mtv-demo)                    MTV: Provider "hetzner" -> Plan
  page: "Running on premises"                  |
  phrase saved on the VM's disk                |  1. reads the VM over the source API (6443)
                                               |  2. copies the disk from the source's
VirtualMachineExport  <------------------------+     VirtualMachineExport route (443)
                                               |  3. creates the VM in mtv-demo
                                             VM where-am-i
                                               page: "Running on AWS", same phrase
```

This is a **cold migration**, the type MTV supports between OpenShift
clusters without extra networking: MTV stops the source VM, copies its disk
and starts it on ROSA. The source VM is stopped, not deleted.

The VM is the official Debian 13 KubeVirt image: about 320 MB of data in a
3 GiB disk. MTV copies the disk as a compressed file and writes out the full
3 GiB on ROSA, so the disk's size, not its data, sets the copy time.

The page is a small Python server that cloud-init installs as a systemd
service. At every boot it asks `ipinfo.io` which network owns the VM's public
IP address: Hetzner on premises, Amazon on ROSA, where the VM's traffic leaves
through the VPC's NAT gateway. A phrase typed into the page is written to
`/var/lib/where-am-i/phrase` on the VM's disk and flushed before the page
confirms it. The page refreshes itself every 3 seconds and shows **Lost
contact** once the VM stops answering.

* `common/`: the `mtv-demo` namespace and the VM's Service and Route, applied
  on both clusters so the ROSA URL exists before the VM arrives.
* `source/`: the VM and its cloud-init Secret, the ServiceAccount and
  ClusterRole that MTV on ROSA uses to read and export it, and a DaemonSet that
  keeps the export server image on every worker.
* `destination/`: the MTV Provider for the source cluster and the network and
  storage maps (`migration-setup.yaml`), the Plan (`plan.yaml`), and a
  Migration to start it from the command line.

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
* `oc` CLI with cluster-admin access on both clusters, and `jq`.

The commands below talk to both clusters, so point a variable at each
cluster's kubeconfig:

```bash
export KUBECONFIG_SOURCE=~/.kube/<on-prem-cluster>
export KUBECONFIG_DEST=~/.kube/<rosa-cluster>
```

## Setup

Run these from this folder. Setup takes about ten minutes, plus one warm-up
migration (step 7), and is done before the talk.

### 1. Let CDI use the source cluster's storage

Skip this if the source cluster's default storage class has a storage profile
with access modes set (`oc get storageprofile <class> -o yaml` shows
`claimPropertySets` under `status`). An NFS provisioner that the Containerized
Data Importer (CDI) does not recognise has none, and VM disks then never bind:

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
echo "https://$(oc --kubeconfig "$KUBECONFIG_SOURCE" get route where-am-i -n mtv-demo -o jsonpath='{.spec.host}')"
```

Open the URL. Within a minute of `Ready` the page shows **Running on
premises** and the source network's name.

### 3. Pre-pull the export server image on the source cluster

When the migration starts, MTV runs an export server pod next to the VM's
disk. This DaemonSet keeps its image on every worker, so the live demo does
not wait for a pull. The image comes from the installed OpenShift
Virtualization:

```bash
EXPORT_IMAGE=$(oc --kubeconfig "$KUBECONFIG_SOURCE" get csv -n openshift-cnv -o json \
  | jq -r '.items[].spec.relatedImages[]? | select(.name | test("virt-exportserver")) | .image' | head -1)
echo "$EXPORT_IMAGE"
sed "s#REPLACE_ME_EXPORTSERVER_IMAGE#$EXPORT_IMAGE#" source/prepull-exportserver.yaml \
  | oc --kubeconfig "$KUBECONFIG_SOURCE" apply -f -
oc --kubeconfig "$KUBECONFIG_SOURCE" rollout status daemonset/prepull-exportserver -n mtv-demo --timeout=5m
```

The image is a `registry.redhat.io/.../virt-exportserver-rhel9@sha256:...`
reference, and the DaemonSet reports every pod rolled out. Repeat this step
after upgrading OpenShift Virtualization.

### 4. Give MTV on ROSA access to the source cluster

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

### 5. Prepare ROSA

The Service and Route go on ROSA too, so the URL is ready before the VM
arrives:

```bash
oc --kubeconfig "$KUBECONFIG_DEST" apply -f common/namespace.yaml -f common/web.yaml
echo "https://$(oc --kubeconfig "$KUBECONFIG_DEST" get route where-am-i -n mtv-demo -o jsonpath='{.spec.host}')"
```

That URL shows "Application is not available" until a migration finishes.

### 6. Register the source cluster in MTV

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

Then create the Provider and the maps, with the source API URL put into the
Provider, and the Plan:

```bash
sed "s#REPLACE_ME_SOURCE_API_URL#$SOURCE_API#" destination/migration-setup.yaml \
  | oc --kubeconfig "$KUBECONFIG_DEST" apply -f -
oc --kubeconfig "$KUBECONFIG_DEST" wait provider/hetzner -n openshift-mtv --for=condition=Ready --timeout=5m
oc --kubeconfig "$KUBECONFIG_DEST" apply -f destination/plan.yaml
oc --kubeconfig "$KUBECONFIG_DEST" wait plan/where-am-i-to-rosa -n openshift-mtv --for=condition=Ready --timeout=5m
oc --kubeconfig "$KUBECONFIG_DEST" get provider,networkmap,storagemap,plan -n openshift-mtv
```

Both providers show `READY` `True`, both maps are `READY`, and the Plan is
`READY`.

### 7. Warm up

The first migration onto a fresh ROSA cluster also pulls the disk importer
and VM images there, which adds time. Run one migration with the command-line
steps in [Running the demo](#running-the-demo), then [reset](#reset-for-another-run).

## Running the demo

For a live audience, [DEMO.md](DEMO.md) has the presenter's run sheet:
pre-flight checks, talking points and what to do if something goes wrong.

Have three browser tabs open:

1. The source page from step 2 (**Running on premises**).
2. The ROSA page from step 5 ("Application is not available").
3. The ROSA console at **Migration for Virtualization > Migration plans**.

Then:

1. Ask the audience for a phrase, type it into the source page, and press
   **Save on this VM's disk**. It appears in yellow under the banner.
2. In the console, open the plan **where-am-i-to-rosa** and press **Start**,
   then confirm. From the command line, the same thing is:

   ```bash
   oc --kubeconfig "$KUBECONFIG_DEST" create -f destination/migration.yaml
   ```

3. Watch the plan's progress: **Initialize** (about 20 seconds; the source VM
   stops and its page turns red, **Lost contact**), **DiskTransfer** (about 80
   seconds), **VirtualMachineCreation** (seconds).
4. Once the plan shows **Succeeded**, reload the ROSA tab. About 20 seconds
   later the page shows **Running on AWS**, Amazon as the network, a new public
   IP and boot time, and the audience's phrase.

From pressing Start to the ROSA page takes about 2 minutes. From the
command line:

```bash
oc --kubeconfig "$KUBECONFIG_DEST" wait plan/where-am-i-to-rosa -n openshift-mtv --for=condition=Succeeded --timeout=15m
oc --kubeconfig "$KUBECONFIG_DEST" wait vm/where-am-i -n mtv-demo --for=condition=Ready --timeout=10m
oc --kubeconfig "$KUBECONFIG_SOURCE" get vm where-am-i -n mtv-demo
curl -s "https://$(oc --kubeconfig "$KUBECONFIG_DEST" get route where-am-i -n mtv-demo -o jsonpath='{.spec.host}')/status" | jq .
```

The ROSA VM is `Running` and `Ready`, the source VM is `Stopped`, and the page
status shows `"title": "Running on AWS"` and the phrase (the `title` reads
"Finding out where I am" for the first few seconds after boot).

## Reset for another run

A Plan that has run cannot be started again, so a rerun needs the migrated VM
removed from ROSA, a fresh Plan, and the source VM started. Archive the Plan
before deleting it, so MTV removes its temporary resources. (MTV deletes the
`VirtualMachineExport` on the source itself when the migration finishes.)

```bash
oc --kubeconfig "$KUBECONFIG_DEST" patch plan where-am-i-to-rosa -n openshift-mtv --type merge -p '{"spec":{"archived":true}}'
oc --kubeconfig "$KUBECONFIG_DEST" wait plan/where-am-i-to-rosa -n openshift-mtv --for=condition=Archived --timeout=5m
oc --kubeconfig "$KUBECONFIG_DEST" delete plan where-am-i-to-rosa -n openshift-mtv
oc --kubeconfig "$KUBECONFIG_DEST" delete vm where-am-i -n mtv-demo
oc --kubeconfig "$KUBECONFIG_DEST" delete secret where-am-i-cloudinit -n mtv-demo
oc --kubeconfig "$KUBECONFIG_SOURCE" patch vm where-am-i -n mtv-demo --type merge -p '{"spec":{"runStrategy":"Always"}}'
```

Deleting the ROSA VM also deletes its disk (MTV makes the VM the disk's
owner). Then re-create the Plan and wait for both sides:

```bash
oc --kubeconfig "$KUBECONFIG_DEST" apply -f destination/plan.yaml
oc --kubeconfig "$KUBECONFIG_DEST" wait plan/where-am-i-to-rosa -n openshift-mtv --for=condition=Ready --timeout=5m
oc --kubeconfig "$KUBECONFIG_SOURCE" wait vm/where-am-i -n mtv-demo --for=condition=Ready --timeout=10m
```

The phrase from the last run is still on the source VM's disk; type a new one
over it in the next run.

## Clean Up

Run the first five commands of the reset, then:

```bash
sed "s#REPLACE_ME_SOURCE_API_URL#unused#" destination/migration-setup.yaml \
  | oc --kubeconfig "$KUBECONFIG_DEST" delete -f -
oc --kubeconfig "$KUBECONFIG_DEST" delete secret hetzner-source -n openshift-mtv
oc --kubeconfig "$KUBECONFIG_DEST" delete -f common/namespace.yaml
oc --kubeconfig "$KUBECONFIG_SOURCE" delete -f source/mtv-token.yaml -f source/mtv-access.yaml
oc --kubeconfig "$KUBECONFIG_SOURCE" delete -f source/vm.yaml -f source/cloud-init.yaml
oc --kubeconfig "$KUBECONFIG_SOURCE" delete -f common/namespace.yaml
```

Deleting the namespaces also removes the Services, Routes and the pre-pull
DaemonSet. Step 1's storage profile change stays; it is harmless.

## Troubleshooting

**Provider `hetzner` is not Ready:** `oc get provider hetzner -n openshift-mtv
-o yaml` shows the condition. The source API must be reachable from ROSA on
port 6443, and the `cacert` must be the source cluster's CA.

**DiskTransfer stays at 0%:** the importer pod on ROSA must reach the source
cluster's `*.apps` routes on port 443 (it downloads from the
`VirtualMachineExport` route). Check the importer pod's log in `mtv-demo`.

**The page says "Running somewhere new":** `ipinfo.io` named a network that is
neither Amazon nor Hetzner, so the page shows its name instead. If it stays on
"Finding out where I am", the VM cannot reach `ipinfo.io`.

**The phrase is missing after the migration:** it is only kept if the page
confirmed it (it appears in yellow) before you pressed Start.

## Related Demos

* [Cross-cluster live migration](../demo-cross-cluster-live-migration/): the
  same two clusters with a stretched Layer 2 network, so the VM keeps its IP.
* [Deploying a VM with OpenShift Virtualization](../demo-deploying-a-vm-with-openshift-virt/)
