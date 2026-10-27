# demo-vllm-model-serving

- **Load models with HuggingFace download Jobs to a PVC** (`storageUri: pvc://`),
  not OCI modelcar images (`oci://`). Modelcar is very slow. `hf download
  --local-dir` skips files already complete, so re-running the Job against an
  existing PVC is quick and safe.
- `hf` reads `HF_TOKEN` from the environment. Do not add `--token`, which puts
  the token in process listings.
- The predictor service `devstral-predictor` is **headless**: its 80 -> 8000
  mapping never applies. Consumers must use port `8000`.
- On a fresh GPU node the predictor takes about 11 minutes to become Ready
  (around 7 minutes pulling the vLLM image, 2 minutes reading weights from a
  new EBS volume, then startup).
- The model PVC is a zonal EBS volume. Keep the GPU pool in the same AZ (see
  `../andys-demo-cluster-tf/CLAUDE.md`).
