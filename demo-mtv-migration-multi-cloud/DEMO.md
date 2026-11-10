# Stage Script: Multi-Cloud VM Migration with MTV

This is the presenter's run sheet for the live demo: what to check before you
go on, what to have on screen, what to click and what to say while the
migration runs. Setup, the reasons behind each step, troubleshooting and clean
up are in the [README](README.md). Everything here assumes the README's Setup,
including the warm-up migration and a reset, is already done.

Live part: about 3 minutes, of which the migration itself is about 2.

## The day before

1. Run the README's [Setup](README.md#setup) on both clusters, steps 1 to 7.
2. Do the warm-up migration (step 7) and then the
   [reset](README.md#reset-for-another-run). Do not skip the warm-up: on a
   fresh ROSA cluster the first migration also pulls the importer and VM
   images, which makes it noticeably slower.
3. If you have time, rehearse the whole script below once more and reset again.

## 15 minutes before you go on

Point a variable at each cluster's kubeconfig:

```bash
export KUBECONFIG_SOURCE=~/.kube/<on-prem-cluster>
export KUBECONFIG_DEST=~/.kube/<rosa-cluster>
```

Run these from the demo folder and check each result:

```bash
# Provider, maps and Plan are all READY True. The Plan must not have run yet:
# if it shows SUCCEEDED, run the reset first.
oc --kubeconfig "$KUBECONFIG_DEST" get provider,networkmap,storagemap,plan -n openshift-mtv

# The source VM is up.
oc --kubeconfig "$KUBECONFIG_SOURCE" wait vm/where-am-i -n mtv-demo --for=condition=Ready --timeout=10m

# There is no VM on ROSA yet: expect "NotFound".
oc --kubeconfig "$KUBECONFIG_DEST" get vm where-am-i -n mtv-demo

# The export server image is still on every source worker.
oc --kubeconfig "$KUBECONFIG_SOURCE" rollout status daemonset/prepull-exportserver -n mtv-demo --timeout=5m

# The two URLs for the browser tabs.
echo "https://$(oc --kubeconfig "$KUBECONFIG_SOURCE" get route where-am-i -n mtv-demo -o jsonpath='{.spec.host}')"
echo "https://$(oc --kubeconfig "$KUBECONFIG_DEST" get route where-am-i -n mtv-demo -o jsonpath='{.spec.host}')"
```

Also check:

* You are logged in to the ROSA console in the browser, and the session will
  not expire during the talk.
* The venue network (or VPN) can reach both URLs and the ROSA console.
* The source page does not already show last run's phrase. If it does, that is
  fine: the audience's phrase will replace it.

## On screen

Open these in order, so you can switch between them with the keyboard:

| Tab | What | Shows before the demo |
|:---|:---|:---|
| 1 | Source page (first URL) | Green, **Running on premises**, the on-premises network's name |
| 2 | ROSA page (second URL) | "Application is not available" |
| 3 | ROSA console, **Migration for Virtualization > Migration plans** | Plan **where-am-i-to-rosa**, Ready |

Keep a terminal open in the demo folder, with both variables exported, as a
fallback for the Start button.

Zoom the browser so the back row can read the page banner.

## Running it

### 1. Set the scene (tab 1, about 30 seconds)

Show the source page.

> "This is a virtual machine running on OpenShift Virtualization, in our own
> datacenter. The page asks the internet who owns its public IP address, and
> right now the answer is our on-premises network. It also shows when the VM
> booted, so you can see it is a new boot when it comes up on the other side."

Show tab 2 briefly.

> "This is the same address on ROSA, OpenShift on AWS. Nothing there yet."

### 2. Take a phrase from the audience (tab 1)

Ask the audience for a phrase. Type it into the box and press **Save on this
VM's disk**. Wait until it appears in yellow under the banner: only a
confirmed phrase is on the disk.

> "That phrase is now written to the VM's own disk. If we see it on AWS, the
> disk came across, not just the VM definition."

### 3. Start the migration (tab 3)

Open the plan **where-am-i-to-rosa**, press **Start**, then confirm.

> "This is the Migration Toolkit for Virtualization, running on ROSA. The
> source cluster is registered as a provider, and this plan says which VM to
> move and how its network and storage map across."

If the Start button does not work, run this in the terminal instead:

```bash
oc --kubeconfig "$KUBECONFIG_DEST" create -f destination/migration.yaml
```

### 4. Talk over the progress (tabs 3 and 1, about 2 minutes)

| Plan phase | Time | What happens | Show |
|:---|:---|:---|:---|
| **Initialize** | about 20 s | MTV stops the source VM | Switch to tab 1: the page turns red, **Lost contact** |
| **DiskTransfer** | about 80 s | ROSA copies the VM's disk from the source cluster | Back to tab 3, watch the progress |
| **VirtualMachineCreation** | seconds | The VM is created and started on ROSA | Tab 3 |

Things to say while the disk copies:

* This is a cold migration: the VM stops, its disk moves, it starts on the
  other side. It is the type MTV supports between two OpenShift clusters
  without any extra networking.
* Both ends run the same platform, OpenShift with OpenShift Virtualization,
  so the VM needs no conversion. It is the same VM, same disk, same
  definition.
* The source VM is stopped, not deleted, so there is always a way back.
* The same tooling migrates from VMware and other hypervisors onto OpenShift.

### 5. The reveal (tab 2)

When the plan shows **Succeeded**, reload tab 2. About 20 seconds later the
page shows **Running on AWS**, Amazon as the network, a new public IP address,
a new boot time, and the audience's phrase in yellow.

> "Same VM, same disk, same phrase, now running on AWS. And it took about two
> minutes."

If tab 2 shows "Finding out where I am", the VM has just booted: wait a few
seconds, the page refreshes itself.

## If something goes wrong

| Symptom | What to do on stage |
|:---|:---|
| **Start** does nothing or errors | Run the `oc create -f destination/migration.yaml` fallback from step 3 |
| Plan stuck in **DiskTransfer** at 0% | The ROSA side cannot reach the source's routes. Explain what should happen and move on; see the README's [Troubleshooting](README.md#troubleshooting) afterwards |
| Tab 2 still says "Application is not available" after **Succeeded** | The VM is still booting. Give it 30 seconds and reload |
| Phrase missing on AWS | It was not confirmed (yellow) before you pressed Start. Point at the new network and boot time instead |
| Page says "Running somewhere new" | The VM's traffic left through a network that is neither Amazon nor the on-premises one. The migration still worked: point at the new IP and boot time |

## After the talk

Run the README's [reset](README.md#reset-for-another-run) so the demo is
ready for the next run, or [Clean Up](README.md#clean-up) if this was the last
one.
