# demo-stretched-layer2-onto-rosa

## EVPN Gateway Appliance is not an alternative yet

[openshift/evpn-gateway-appliance](https://github.com/openshift/evpn-gateway-appliance)
(EGA) is the future production route for stretching L2 into AWS: BGP EVPN with
VXLAN, an on-prem bootc appliance, and a relay in an infra VPC. As of
2026-11-23 it is not an alternative to this demo on ROSA:

- Unreleased: no tags or releases, and its Ansible collection says "intended
  for lab/dev/test use".
- The cloud-side VTEP in the collection is a standalone FRR VM that only
  emulates OpenShift. The production design uses OpenShift-native EVPN
  (FRR-K8s and OVN-Kubernetes, OCP 4.22+), which the 4.22 docs support only on
  bare-metal clusters. Enabling it means patching
  `Network.operator.openshift.io/cluster`, which ROSA manages.
- Its support matrix, including ROSA, is an open decision (Gate C-prod in its
  `plans/context/evpn-aws/kickoff-decisions.md`).
- Its `provision-aws.yml` creates VPCs, a Transit Gateway and EC2 instances
  with Ansible, so any lab build here would have to move that into Terraform.

Revisit when it tags a release or its support matrix includes ROSA.
