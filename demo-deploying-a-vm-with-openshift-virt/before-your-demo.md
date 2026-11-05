# Prep for OpenShift virt demo

## Install OpenShift virt

Go to [../openshift-virt](../openshift-virt) and follow the instructions there,
including its verify step: the metal node must offer KVM (`1k` in the
`KVM` column).

## Check the golden images

The console's templates and the command-line path both clone their disk from a
golden image. They are imported once, a few minutes after OpenShift
Virtualization is turned on:

```bash
oc get datavolume -n openshift-virtualization-os-images
```

Wait until the `fedora-...` DataVolume shows `Succeeded`.

## Clear the previous run

If you have given this demo on the cluster before, run the README's
[Clean Up](README.md#clean-up) first.
