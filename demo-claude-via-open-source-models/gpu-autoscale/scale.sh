#!/usr/bin/env bash
#
# Scale the GPU machine pool up or down via the OCM API (rosa CLI).
#
# ROSA HCP machine-pool size lives in the Red Hat control plane, not in any
# Kubernetes object, so this container talks out to OCM with client
# credentials stored in the `ocm-client` Secret.
#
# Auth: provide EITHER a client-credentials pair (preferred, durable) OR a
# long-lived OCM offline token.
#   OCM_CLIENT_ID + OCM_CLIENT_SECRET   OCM API client (preferred)
#   OCM_OFFLINE_TOKEN                   OCM offline access token (fallback)
#
# Env (required unless noted):
#   CLUSTER_ID             ROSA cluster id
#   POOL_NAME              machine pool to scale (e.g. poc-andyr-gpu)
#   TARGET_REPLICAS        desired replica count (0 = off, 2 = on)
#   POLL_INTERVAL_SECONDS  seconds between checks        (default 120)
#   MAX_ATTEMPTS           max polling attempts          (default 15, = 30 min)

set -euo pipefail

: "${CLUSTER_ID:?CLUSTER_ID is required}"
: "${POOL_NAME:?POOL_NAME is required}"
: "${TARGET_REPLICAS:?TARGET_REPLICAS is required (0 or 2)}"

if [ -n "${OCM_CLIENT_ID:-}" ] && [ -n "${OCM_CLIENT_SECRET:-}" ]; then
  AUTH_MODE="client"
elif [ -n "${OCM_OFFLINE_TOKEN:-}" ]; then
  AUTH_MODE="token"
else
  echo "ERROR: set OCM_CLIENT_ID+OCM_CLIENT_SECRET or OCM_OFFLINE_TOKEN" >&2
  exit 2
fi

POLL_INTERVAL="${POLL_INTERVAL_SECONDS:-120}"
MAX_ATTEMPTS="${MAX_ATTEMPTS:-15}"

# rosa stores credentials in $HOME/.ocm.json
export HOME="${HOME:-/tmp}"

log() { echo "[gpu-scale] $*"; }

current_replicas() {
  rosa list machinepools --cluster "${CLUSTER_ID}" --output json 2>/dev/null |
    jq -r --arg id "${POOL_NAME}" '.[] | select(.id == $id) | .status.current_replicas'
}

# 1. Authenticate. rosa login is idempotent; it writes credentials to
#    $HOME/.ocm.json which the subsequent commands read. Client credentials
#    are durable (no session expiry); the offline token is the fallback.
if [ "${AUTH_MODE}" = "client" ]; then
  log "authenticating with OCM client credentials"
  rosa login --client-id "${OCM_CLIENT_ID}" --client-secret "${OCM_CLIENT_SECRET}" --color never
else
  log "authenticating with OCM offline token"
  rosa login --token "${OCM_OFFLINE_TOKEN}" --color never
fi

# 2. Idempotency check: if already at the target, nothing to do.
#    Covers "forgot to scale up in the morning" / double runs.
current="$(current_replicas)"
if [ "${current}" = "${TARGET_REPLICAS}" ]; then
  log "pool '${POOL_NAME}' already at ${TARGET_REPLICAS} replicas, nothing to do"
  exit 0
fi
log "pool '${POOL_NAME}' is at ${current} replicas, scaling to ${TARGET_REPLICAS}"

# 3. Request the scale change. This returns quickly; the nodes then take
#    several minutes to actually appear/disappear.
rosa edit machinepool --replicas="${TARGET_REPLICAS}" --cluster "${CLUSTER_ID}" "${POOL_NAME}" --yes --color never
log "scale request accepted, waiting for pool to reach ${TARGET_REPLICAS} replicas"

# 4. Poll until the actual replica count reaches the target.
#    Scale-up retries matter: g7e.2xlarge can lack capacity in the AZ, in
#    which case the pool stays below target and the node simply hasn't
#    been provisioned yet. Scale-down failing means we keep paying, so it
#    also exits non-zero to surface in the CronJob history.
attempt=1
while [ "${attempt}" -le "${MAX_ATTEMPTS}" ]; do
  sleep "${POLL_INTERVAL}"
  current="$(current_replicas || echo '?')"
  log "attempt ${attempt}/${MAX_ATTEMPTS}: current_replicas=${current}"
  if [ "${current}" = "${TARGET_REPLICAS}" ]; then
    log "success: pool '${POOL_NAME}' is at ${TARGET_REPLICAS} replicas"
    exit 0
  fi
  attempt=$((attempt + 1))
done

log "FAILED: pool '${POOL_NAME}' did not reach ${TARGET_REPLICAS} replicas within $((MAX_ATTEMPTS * POLL_INTERVAL / 60)) minutes"
if [ "${TARGET_REPLICAS}" != "0" ]; then
  log "Likely cause: no g7e.2xlarge capacity in the AZ right now. Retry the scale-up."
fi
exit 1