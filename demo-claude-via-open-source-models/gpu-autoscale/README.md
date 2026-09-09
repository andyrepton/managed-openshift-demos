# GPU pool autoscaler (scale down overnight, scale up in the morning)

Stops the two `g7e.2xlarge` GPU instances billing overnight by scaling the
`poc-andyr-gpu` machine pool to 0, and scales it back to 2 in the morning.

ROSA HCP machine-pool size lives in the Red Hat **control plane**, not in any
Kubernetes object — there is nothing in-cluster you can `kubectl scale`.
So a `CronJob` in the cluster calls out to the OCM API (via the `rosa` CLI)
with client credentials kept in a cluster **Secret**. The credentials never
leave the cluster; nothing is added to GitHub.

## Files

| File | Purpose |
|------|---------|
| `Dockerfile` | Minimal UBI9 image + statically-linked `rosa` + `jq` |
| `scale.sh` | Login to OCM, scale the pool, poll until `current_replicas` matches the target |
| `cronjob-scale-down.yaml` | 21:15 daily → `replicas=0` |
| `cronjob-scale-up.yaml` | 06:15 daily → `replicas=2` |
| `ocm-client-secret.yaml` | **Template only.** Do not commit real credentials |

## 1. Get OCM credentials

The CronJob needs a **non-interactive** credential to call the OCM API.
Two options, in order of preference:

### Option A (preferred): OCM API client credentials

A client-credentials pair is durable — it has no user session to expire, so
the CronJob keeps working weeks later (unlike a personal token).

1. Log in to the Red Hat console at `https://console.redhat.com`.
2. In the console, create an **API client** / **API key**. It lives under
   **OpenShift** in the console — look for an *API Clients* / *Client
   credentials* section. Create a new client named e.g. `gpu-pool-scaler`.
   (The exact screen has moved between console versions; if you can't find
   it, search "API client" in the console, or use Option B below.)
3. Copy the **client id** and **client secret**.

> **Verified note:** there is no self-service `POST /clients` REST endpoint
> for minting clients (confirmed against the OCM OpenAPI spec at
> `https://api.openshift.com/api/clusters_mgmt/v1/openapi`) — clients are
> created in the console UI only. Don't waste time looking for a curl for it.
>
> If you can create one, **scope the client to a limited role** (e.g. a
> machine-pool / cluster-manager role) so it can resize node pools without
> being able to read cluster contents. Smaller blast radius than a full
> operator credential.

### Option B (fallback): long-lived OCM offline token

If the client screen is fiddly, use an OCM **offline access token** (which
does not expire like the short-lived access token does):

1. Go to `https://console.redhat.com/openshift/token/rosa` while logged in.
2. Generate an **offline** access token and copy it.
3. Use it via the `OCM_OFFLINE_TOKEN` env var (see the Secret below).

`scale.sh` auto-detects which mode: if `OCM_CLIENT_ID` + `OCM_CLIENT_SECRET`
are set it uses client credentials; otherwise it falls back to
`OCM_OFFLINE_TOKEN`.

## 2. Create the Secret

Client credentials (Option A):
```bash
oc -n claude-code-demo create secret generic ocm-client \
  --from-literal=client-id=<CLIENT_ID> \
  --from-literal=client-secret=<CLIENT_SECRET>
```

Offline token (Option B):
```bash
oc -n claude-code-demo create secret generic ocm-client \
  --from-literal=offline-token=<OFFLINE_TOKEN>
```

Do **not** fill in `ocm-client-secret.yaml` and commit it.

## 3. Build and push the image

```bash
cd gpu-autoscale
docker buildx build --platform linux/amd64 \
  -t quay.io/<your-org>/gpu-pool-scaler:latest .
docker push quay.io/<your-org>/gpu-pool-scaler:latest
```

The image is amd64 (g7e / cluster nodes are amd64). Build with `buildx
--platform linux/amd64` even from an arm64 Mac.

## 4. Patch the image and apply

Replace `quay.io/REPLACE_WITH_YOUR_ORG/gpu-pool-scaler:latest` in both
CronJob files with your real image, and confirm the cron schedule matches
your **cluster's timezone** (ROSA control-plane cron uses the cluster's local
time — typically UTC; check with `oc exec` a node or `date`):

```bash
oc apply -f cronjob-scale-up.yaml
oc apply -f cronjob-scale-down.yaml
```

## 5. Test

Run each direction once, manually, before trusting the schedule:

```bash
# Scale down now (safe to do at any time; model pods will go 0/1 pending)
oc create job test-scale-down \
  --from=cronjob/gpu-pool-scale-down -n claude-code-demo
oc get pods -n claude-code-demo -w

# Wait for it to succeed, then scale back up
oc create job test-scale-up \
  --from=cronjob/gpu-pool-scale-up -n claude-code-demo
oc get pods -n claude-code-demo -w
```

Confirm in the AWS console that the two `g7e.2xlarge` instances are
terminated after scale-down and recreated after scale-up.

## 6. Verify the schedule

```bash
oc get cronjob -n claude-code-demo
oc get jobs -n claude-code-demo
oc logs -n claude-code-demo job/gpu-pool-scale-down-<ts>
```

## Behaviour and gotchas

- **Idempotent.** `scale.sh` checks `current_replicas` first; if the pool is
  already at the target it exits 0. So a missed morning run won't double-
  scale, and re-running is safe.
- **Scale-up retries for capacity.** g7e.2xlarge is a high-demand family. If
  the 06:15 scale-up lands on an AZ with no capacity, the job exits 1 and
  Kubernetes retries on the next schedule tick (with `backoffLimit: 2`
  retries within the job). If you need it earlier, move the scale-up cron
  earlier rather than adding complexity.
- **It's not instant in the morning.** After scale-up: ~10–20 min of node
  provisioning, then model pods reschedule onto the fresh nodes, models
  reload from the PVCs (**no re-download**), then the 30–60 s CUDA warm-up.
  So 06:15 scale-up → usable by ~06:40, well before work starts.
- **Model pods flap at 0.** While the pool is at 0 the two InferenceService
  pods show `0/1` (pending, no node). This is expected overnight and resolves
  automatically at scale-up. If you want them to look tidy, you can also
  scale the two InferenceServices to 0 at 21:00 and back to 1 at 05:00 —
  but it's cosmetic, the CronJob here is the one that stops the billing.
- **Terraform drift.** The pool is also defined in Terraform
  (`andys-demo-cluster-tf/rosa/modules/openshift-ai/openshift-ai-machine-pool.tf`,
  `replicas = 2`). A `terraform apply` will revert the pool to 2. Make the
  replica count a variable (default 2) if you also run Terraform, so both
  paths agree.
- **Cost.** Two g7e.2xlarge instances overnight is roughly $40–60 per 12 h
  (check the exact eu-west-2 on-demand rate in your AWS console) → on the
  order of $1,000–1,500/month saved.

## Rolling back

```bash
oc delete cronjob gpu-pool-scale-down -n claude-code-demo
oc delete cronjob gpu-pool-scale-up -n claude-code-demo
# Scale the pool back to 2 manually
rosa edit machinepool --replicas=2 --cluster=2se5gi3k8ssrahi8iatg5arudlomk9rp poc-andyr-gpu
```