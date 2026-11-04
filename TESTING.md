# End-to-end test status

Each demo is tested by following its README word for word on a real cluster,
to the end state a user sees. A tested README also carries a `Tested:` line
under its summary. Status values: **passed**, **failed**, **not tested** (with
the reason), **pending** (planned, not run yet).

Test campaign started 2026-11-04: one cluster build at a time.

| Demo | Cluster build | Platform | Status | Date | Notes |
|:---|:---|:---|:---|:---|:---|
| andys-demo-cluster-tf | 1 | ROSA HCP 4.22.12 | passed | 2026-11-04 | Build 1 (`ai_rosa.tfvars`, `-var ai_gpu_replicas=2`): 76 resources, both GPU nodes Ready; later builds add more presets |
| openshift-ai | 1. ROSA AI | ROSA HCP 4.22.12, RHOAI 3.5.2 | passed | 2026-11-04 | Tested from branch prereq-readme-fixes (fix 3) |
| demo-vllm-model-serving | 1. ROSA AI | ROSA HCP 4.22.12, RHOAI 3.5.2 | passed | 2026-11-04 | Devstral serves and answers (fixes 11, 33, 34) |
| demo-claude-via-open-source-models | 1. ROSA AI | ROSA HCP 4.22.12, RHOAI 3.5.2 | passed | 2026-11-04 | Tested from branch prereq-readme-fixes, both models (fixes 1, 2, 14, 16, 18, 21-24). Not tested: Cursor, interactive `/model`, cleanup |
| openshift-devspaces | 1. ROSA AI | ROSA HCP 4.22.12, Dev Spaces 3.31.2 | passed | 2026-11-04 | Workspaces opened in dependent demos (fix 17) |
| demo-opencode-devspaces | 1. ROSA AI | ROSA HCP | pending | | |
| demo-object-detection-on-rosa | 1. ROSA AI | ROSA HCP 4.22.12 | passed | 2026-11-04 | Runs on CPU (fixes 10, 15); cleanup not run |
| demo-lightspeed-tuning | 1. ROSA AI | ROSA HCP 4.22.12, Lightspeed 2.0.0 | passed | 2026-11-04 | Live tool-call answer as cluster-admin; devuser in the bound group gets access and tools respect its RBAC (fixes 26-28). External MCP servers not tested (example URLs) |
| demo-maas-on-rosa | 1. ROSA AI | ROSA HCP 4.22.12, RHOAI 3.5.2 | passed | 2026-11-04 | Run by a person in an in-cluster workbench as devuser; key, model list and chat completion all work (fixes 12, 29-32). Simulator notebook not tested |
| demo-custom-udi | 1. ROSA AI | ROSA HCP | pending | | |
| demo-source2image | 1. ROSA AI | ROSA HCP 4.22.12, Dev Spaces 3.31.2 | passed | 2026-11-04 | Steps 5-6 run inside a real workspace; edit, rebuild and live change confirmed (fixes 19, 20); cleanup not run |
| demo-developer-hub | 1. ROSA AI | ROSA HCP | pending | | |
| demo-rhdh-cluster-planner | 1. ROSA AI | ROSA HCP | pending | | |
| demo-rhdh-devspaces-self-service | 1. ROSA AI | ROSA HCP | pending | | |
| demo-semantic-router-claude-code | 1. ROSA AI | ROSA HCP 4.22.12, RHOAI 3.5.2 | passed (partly) | 2026-11-04 | On branch demo-semantic-router-claude-code. All steps and Claude Code pass; the frontier tier awaits a canonical Anthropic model (fix 25) |
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

## Fixes found

Every README problem found while testing, and what was done about it. Status:
**fixed** (README changed and the step re-run successfully), **to fix** (found,
not yet changed), **not fixable yet** (with the reason).

| # | Demo | Branch | Problem | Fix | Status |
|:--|:---|:---|:---|:---|:---|
| 1 | demo-claude-via-open-source-models | prereq-readme-fixes | Step 2: the loop waiting for the cert-manager CSV matched RHOAI's CSV, which is copied into every namespace, so `oc wait` still failed with "no matching resources" | Match the cert-manager CSV by name | fixed |
| 2 | demo-claude-via-open-source-models | prereq-readme-fixes | Step 4 creates PostgreSQL before enabling MaaS, but its `maas-db-config` Secret targets `redhat-ai-gateway-infra`, which does not exist until MaaS is enabled | Enable MaaS first, wait for its namespace, then deploy PostgreSQL; MaaS then starts with no restart (verified: maas-api 0 restarts) | fixed |
| 3 | openshift-ai | prereq-readme-fixes | Step 5 creates `redhat-ods-operator` twice (`namespace.yaml` and `subscription.yaml`) | Apply only `subscription.yaml`, which already contains the Namespace (shown by its "unchanged" output); `namespace.yaml` stays for Cleanup | fixed |
| 4 | demo-gitlab-duo-on-rosa | demo-readme-summaries | No model deploy step; `rosa create machinepool` instead of Terraform; model names differ between catalog, InferenceService and Continue config; broken image links | | not fixable yet: needs a GitLab Duo licence to test |
| 5 | demo-multi-namespace-log-metrics-forwarding | demo-readme-summaries | Says Logging 5.8+ but uses the 6.x API; wrong path `user/coo.yaml`; broken line continuations; a Secret in `clf.yaml` overwrites one created in step 2 | | not fixable yet: needs a New Relic account to test |
| 6 | demo-openshift-logging | demo-readme-summaries | Uses the Logging 5.x API, which may not work on current versions | | to fix (cluster build 2) |
| 7 | demo-deploy-s3-buckets-with-ack | demo-readme-summaries | Points to a `./create-demo.sh` that does not exist | | to fix (cluster build 2) |
| 8 | demo-autonode-on-rosa | demo-readme-summaries | README says `OpenShiftEC2NodeClass`, the manifest uses `EC2NodeClass` | | to fix (cluster build 5) |
| 9 | demo-graviton-on-rosa | demo-readme-summaries | Namespace inconsistent (`multiarch-demo` vs `multiarch-demo-proj`) | | to fix (cluster build 2) |
| 10 | demo-object-detection-on-rosa | demo-readme-summaries | Lists OpenShift AI and a GPU as prerequisites, but the steps use neither | Prerequisites now say it runs on CPU with no GPU or OpenShift AI (verified: no GPU request, scheduled on a CPU node) | fixed |
| 11 | demo-vllm-model-serving | demo-readme-summaries | Prerequisites say `HF_TOKEN`, the commands use `HUGGING_FACE_HUB_TOKEN`; the token was passed with `--from-literal` | `read -rs` and stdin | fixed |
| 12 | demo-maas-on-rosa | demo-readme-summaries | Notebooks use `verify=False` and a hardcoded cluster URL; one had saved outputs naming an old cluster | Verify TLS (the ROSA ingress certificate is trusted), require `MAAS_URL`, clear saved outputs | fixed |
| 13 | several | demo-readme-summaries | Personal values left in (cluster prefixes, an email address in tags, presenter domains) | | to fix as each demo is tested |
| 14 | demo-claude-via-open-source-models | prereq-readme-fixes | Step 6 applies `models/hf-token-secret.yaml`, which is gitignored and so missing from any fresh clone | Create the `hf-token` Secret with `read -rs` and stdin; update the models/README file tree | fixed |
| 15 | demo-object-detection-on-rosa | demo-readme-summaries | Verify says to open a web interface; the app has none (`/` returns a status), and the `/predictions` request format was not given | Verify with `curl` on `/status` and a POST of the repo's sample image, piped to `jq` | fixed |
| 16 | demo-claude-via-open-source-models | prereq-readme-fixes | Download estimates were 30-45 min (Granite) and 5-10 min (Qwen); measured 7m56s and 2m49s | Say "about 10 minutes" and "about 3 minutes" | fixed |
| 17 | openshift-devspaces | demo-readme-summaries | Verify says the CheCluster should show Available; the phase is `Active` | Say Active | fixed |
| 18 | demo-claude-via-open-source-models | prereq-readme-fixes | Step 7 passes the OpenShift / ServiceAccount token to curl as a command-line argument | Send it on stdin with `curl -H @-` | fixed |
| 19 | demo-source2image | demo-readme-summaries | Step 6 uses a placeholder, `oc new-app --name demo <image-from-imagestream>` | `oc new-app --name demo --image-stream=demo:latest` | fixed |
| 20 | demo-source2image | demo-readme-summaries | Steps 5-6 run in the Dev Spaces terminal, whose current project is the user's Dev Spaces project, so the build landed outside `s2i-demo` and Cleanup would miss it | Add `oc project s2i-demo` to step 5 (README and during-your-demo.md) | fixed |
| 21 | demo-claude-via-open-source-models | prereq-readme-fixes | Step 8 passes the LiteLLM and MaaS keys to `oc create secret` with `--from-literal`, as command-line arguments | `--from-env-file=<(printf ...)` | fixed |
| 22 | demo-claude-via-open-source-models | both | Step 10 sends the LiteLLM key as a curl argument and pretty-prints with Python | `ask` function using `curl -H @-` and `jq` (on prereq-readme-fixes; the summaries branch keeps only its summary paragraph for this README to avoid a merge conflict) | fixed |
| 23 | demo-claude-via-open-source-models | prereq-readme-fixes | Usage Monitoring check greps the DSCI YAML, which prints the condition types but not reliably their statuses | Print each condition's status with jsonpath | fixed |
| 24 | demo-claude-via-open-source-models | prereq-readme-fixes | "Accessing the Dashboard" says the dashboard flag was enabled in Step 6; it is Step 5 | Say Step 5 | fixed |
| 25 | demo-semantic-router-claude-code | demo-semantic-router-claude-code | Step 4 checks AuthPolicy Enforced immediately after creating it, before it has been enforced (prints nothing) | `oc wait --for=condition=Enforced` | fixed |
| 26 | demo-lightspeed-tuning | demo-readme-summaries | The three OLSConfig files list feature gates as objects (`- name: MCPServer`); Lightspeed operator v2.0.0 rejects them and requires plain strings | List them as strings (`- MCPServer`) | fixed |
| 27 | demo-lightspeed-tuning | demo-readme-summaries | `rbac.yaml` binds `lightspeed-operator-ols-user`, which no longer exists in operator v2.0.0, so users get 403 | Bind `lightspeed-operator-query-access` | fixed |
| 28 | demo-lightspeed-tuning | demo-readme-summaries | The token and MCP credentials went into YAML files, and one `REPLACE_ME` stood for both the endpoint URL and the model | Secrets from stdin; distinct placeholders filled with `sed` at apply time | fixed |
| 29 | demo-maas-on-rosa | demo-readme-summaries | `oss-gpt-demo.ipynb` was malformed (code cells without `outputs`), so strict Jupyter tooling refused it | Add the empty `outputs` field | fixed |
| 30 | demo-maas-on-rosa | demo-readme-summaries | The demo ran on a laptop and got its token from `oc whoami -t`, which does not exist in a workbench | Run in an OpenShift AI workbench, authenticate with its ServiceAccount token, and add that ServiceAccount to the MaaS subscription and auth policy | fixed |
| 31 | demo-maas-on-rosa | demo-readme-summaries | The notebook always used the first listed model, which the key may not be allowed to use (403) | Choose the model with `MAAS_MODEL` | fixed |
| 32 | demo-maas-on-rosa | demo-readme-summaries | Model URLs end in `/`, so the chat URL had `//v1/...` and returned 404 | Strip the trailing slash | fixed |
| 33 | demo-vllm-model-serving | demo-readme-summaries | `oc wait ... pod -l ...` right after creating the InferenceService fails with "no matching resources" | Wait on `inferenceservice/devstral` instead | fixed |
| 34 | demo-vllm-model-serving | demo-readme-summaries | Verify uses `oc run --rm -i` curl pods, which race the attach: output is lost, pods are left behind, and they trip PodSecurity warnings | `oc exec` curl inside the predictor pod, piped to `jq` | fixed |
