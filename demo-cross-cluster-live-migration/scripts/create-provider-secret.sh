#!/bin/bash
set -euo pipefail

if [ $# -lt 3 ]; then
  echo "Usage: $0 <secret-name> <api-url> <sa-token> [ca-cert-file]"
  echo ""
  echo "Creates the Secret that an MTV Provider references for remote cluster access."
  echo "If the remote cluster uses a self-signed CA, pass the CA cert file as the 4th argument."
  echo ""
  echo "Example:"
  echo "  $0 hetzner-provider-secret https://api.hetzner.example.com:6443 eyJhbG..."
  echo "  $0 hetzner-provider-secret https://api.hetzner.example.com:6443 eyJhbG... /tmp/hetzner-ca.crt"
  exit 1
fi

SECRET_NAME=$1
API_URL=$2
TOKEN=$3
CA_CERT=${4:-}

if [ -n "$CA_CERT" ]; then
  oc create secret generic "$SECRET_NAME" \
    --from-literal=token="$TOKEN" \
    --from-literal=url="$API_URL" \
    --from-file=cacert="$CA_CERT" \
    -n openshift-mtv
else
  oc create secret generic "$SECRET_NAME" \
    --from-literal=token="$TOKEN" \
    --from-literal=url="$API_URL" \
    -n openshift-mtv
fi
