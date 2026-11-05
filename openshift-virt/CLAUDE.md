# OpenShift Virtualization

## Stop VMs before touching the metal pool

VMs default to the `LiveMigrate` eviction strategy. With one metal node and EBS
(ReadWriteOnce) storage they cannot migrate, so eviction is refused and the
node never drains. A machine pool delete or replace then hangs, and ROSA
refuses to recreate a pool with the same name ("A NodePool with name ... is
being deleted") until the old node is gone.

Before deleting, replacing or scaling down the metal pool, stop every VM on it:

```bash
oc patch vm <name> -n <namespace> --type merge -p '{"spec":{"runStrategy":"Halted"}}'
```

Set `runStrategy: Always` again once the new node is up. Stopping a VM keeps
its disk; it is not a delete.
