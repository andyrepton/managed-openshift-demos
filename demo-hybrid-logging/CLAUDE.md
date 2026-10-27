# demo-hybrid-logging

S3 and IAM gotchas for the LokiStack bucket live in
`../andys-demo-cluster-tf/CLAUDE.md`. These are the in-cluster ones.

- **`adminGroups` must include `cluster-admins` on ROSA/OSD.** Set
  `spec.tenants.openshift.adminGroups` to at least `system:cluster-admins`,
  `cluster-admins`, `cluster-admin`, `dedicated-admins`. The Loki Operator
  defaults miss `cluster-admins` (the ROSA/OSD admin group), and opa-openshift
  filters cluster-wide queries by namespaces that exist locally, so logs
  forwarded from another cluster return 403 / "Missing permissions" in the
  Console Logs UI.
- **Keep the forwarder's bearer-token Secret out of the ClusterLogForwarder
  manifest.** A Secret with a placeholder token in the same file overwrites the
  real one on every `oc apply`. Create it as a separate step.
