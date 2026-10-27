# openshift-ai

## RHOAI scaled down to free CPU

Scaling `rhods-operator` back up does **not** restore the application
deployments in `redhat-ods-applications`: the operator ran at 3 replicas for
days while every app stayed at 0. Restore them directly
(`oc scale deploy --all -n redhat-ods-applications --replicas=1`) once there is
CPU headroom. On three 4-vCPU workers RHOAI alone takes about 37% of
requestable CPU; the AI machine pool (2x m5.4xlarge) gives it room.

A `DataScienceCluster` condition such as `KserveReady=True` can be stale while
the controller has 0 replicas. Check the deployments, not just the DSC status.

## NVIDIA driver CrashLoopBackOff on ARO HCP

Caused by a kernel/DTK mismatch: the `driver-toolkit` imagestream has a newer
kernel than the node, and ARO HCP nodes have no RHEL entitlement, so the
entitled-build fallback fails too.

1. Confirm: `oc logs <driver-pod> -c openshift-driver-toolkit-ctr` reports
   "broken Driver Toolkit image detected" with both kernel versions.
2. Check the imagestream tags:
   `oc get imagestream driver-toolkit -n openshift -o jsonpath='{.spec.tags[*].name}'`.
3. Upgrade the node pool version in Terraform so the node's RHCOS kernel
   matches the DTK image (see `aro_hcp_node_pool_version` in
   `../andys-demo-cluster-tf/CLAUDE.md`).
4. Scale the GPU operator to 0, delete its stale leader lease, and scale back
   to 1 after the node upgrade.
5. If the RHCOS build date still does not match, tag the imagestream:
   `oc tag openshift/driver-toolkit:<new> openshift/driver-toolkit:<old>`.

On ROSA the driver builds normally: the DTK container compiles the modules,
then the driver container installs the userspace parts (allow a few minutes
on a new node).
