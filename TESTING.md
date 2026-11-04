# End-to-end test status

Each demo is tested by following its README word for word on a real cluster,
to the end state a user sees. A tested README also carries a `Tested:` line
under its summary. Status values: **passed**, **failed**, **not tested** (with
the reason), **pending** (planned, not run yet).

Test campaign started 2026-11-04: one cluster build at a time.

| Demo | Cluster build | Platform | Status | Date | Notes |
|:---|:---|:---|:---|:---|:---|
| andys-demo-cluster-tf | 1 | ROSA HCP | pending | | Tested by building each cluster below |
| openshift-ai | 1. ROSA AI | ROSA HCP | pending | | |
| demo-vllm-model-serving | 1. ROSA AI | ROSA HCP | pending | | |
| demo-claude-via-open-source-models | 1. ROSA AI | ROSA HCP | pending | | |
| openshift-devspaces | 1. ROSA AI | ROSA HCP | pending | | |
| demo-opencode-devspaces | 1. ROSA AI | ROSA HCP | pending | | |
| demo-object-detection-on-rosa | 1. ROSA AI | ROSA HCP | pending | | |
| demo-lightspeed-tuning | 1. ROSA AI | ROSA HCP | pending | | |
| demo-maas-on-rosa | 1. ROSA AI | ROSA HCP | pending | | |
| demo-custom-udi | 1. ROSA AI | ROSA HCP | pending | | |
| demo-source2image | 1. ROSA AI | ROSA HCP | pending | | |
| demo-developer-hub | 1. ROSA AI | ROSA HCP | pending | | |
| demo-rhdh-cluster-planner | 1. ROSA AI | ROSA HCP | pending | | |
| demo-rhdh-devspaces-self-service | 1. ROSA AI | ROSA HCP | pending | | |
| logging-operator-lokistack | 2. ROSA logging | ROSA HCP | pending | | |
| demo-openshift-logging | 2. ROSA logging | ROSA HCP | pending | | |
| demo-forward-logs-to-aws-cloudwatch | 2. ROSA logging | ROSA HCP | pending | | |
| demo-forward-metrics-to-aws-cloudwatch | 2. ROSA logging | ROSA HCP | pending | | |
| demo-deploy-s3-buckets-with-ack | 2. ROSA logging | ROSA HCP | pending | | |
| demo-deploying-an-app-with-service-mesh | 2. ROSA logging | ROSA HCP | pending | | |
| openshift-gitops | 2. ROSA logging | ROSA HCP | pending | | |
| demo-deploying-segregated-gitops | 2. ROSA logging | ROSA HCP | pending | | |
| rh-interconnect | 2. ROSA logging | ROSA HCP | pending | | |
| demo-graviton-on-rosa | 2. ROSA logging | ROSA HCP | pending | | |
| openshift-virt | 3. ROSA virtualization | ROSA HCP | pending | | |
| demo-deploying-a-vm-with-openshift-virt | 3. ROSA virtualization | ROSA HCP | pending | | |
| demo-mtv-migration-multi-cloud | 3. ROSA virtualization | ROSA HCP | pending | | Source side only |
| demo-bgp-on-rosa | 4. ROSA BGP | ROSA HCP | pending | | Throwaway cluster |
| demo-autonode-on-rosa | 5. Own Terraform | ROSA HCP | pending | | |
| rosa-hcp-with-user-add | 5. Own Terraform | ROSA HCP | pending | | |
| demo-openshift-virt-on-osd | 7. OSD on Google Cloud | OSD (GCP) | pending | | Bare-metal c3 workers |
| demo-gitlab-duo-on-rosa | | | not tested | | Needs a GitLab Duo licence |
| demo-multi-namespace-log-metrics-forwarding | | | not tested | | Needs a New Relic account |
| demo-multi-region-rosa | | | not tested | | Needs a Route 53 domain and certificates |
| demo-hybrid-acm | | | not tested | | On-premises demos skipped for now |
| demo-hybrid-logging | | | not tested | | On-premises demos skipped for now |
| demo-stretched-layer2-onto-rosa | | | not tested | | On-premises demos skipped for now |
| demo-cross-cluster-live-migration | | | not tested | | On-premises demos skipped for now |
