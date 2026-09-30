#!/bin/bash
set -euo pipefail

NS=${1:-openshift-mtv}
SECRET=${2:-mtv-cclm-token}

TOKEN=$(oc get secret "$SECRET" -n "$NS" -o jsonpath='{.data.token}' | base64 --decode)
echo "$TOKEN"
