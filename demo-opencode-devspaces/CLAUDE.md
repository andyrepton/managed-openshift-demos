# demo-opencode-devspaces

## Rebuild order

1. `../andys-demo-cluster-tf/`: GPU pool via Terraform, after the capacity test
   (a 48 GiB+ GPU; `g7e.2xlarge` has 96 GB). The AI pool's 2x m5.4xlarge
   gives RHOAI the CPU it needs.
2. `../openshift-ai/`
3. `../demo-vllm-model-serving/`: allow about 11 minutes for the predictor on
   a fresh GPU node.
4. `../openshift-devspaces/`
5. `../demo-custom-udi/`, for the workspace image.

## Patterns between these demos

- **To run this workspace on the custom UDI, launch
  `demo-custom-udi/devfile.yaml`.** It is this demo's devfile with the image
  swapped. This demo's own devfile deliberately keeps the stock UDI, so it
  still works where the custom image was never built.
- The model endpoint is
  `http://devstral-predictor.vllm-model-serving.svc.cluster.local:8000/v1`.
  The service is headless, so port 80 times out.
- Workspaces must be **new** to pick up a changed image or devfile. Reopening a
  stopped one keeps the old image and home volume, so delete old test
  workspaces first.
- With `pvcStrategy: per-user`, a user's storage is one zonal volume. If a
  workspace fails with "didn't match PersistentVolume's node affinity", check
  which AZ that volume is in against where the free CPU is.
- Logging in to the dashboard as the workspace user needs a browser, so the
  final checks (versions, configs, `opencode run`) are done by hand.
