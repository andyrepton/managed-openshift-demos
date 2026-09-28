#!/bin/bash
set -euo pipefail

# Generates shared PKI for the cluster-to-cluster VPN tunnel.
# Run once, then distribute certs to both clusters.

PKI_DIR="${1:-./pki}"
mkdir -p "$PKI_DIR"
cd "$PKI_DIR"

if [ -f ca.crt ]; then
  echo "PKI already exists in $PKI_DIR — delete it first to regenerate."
  exit 0
fi

echo "--- Generating PKI in $PKI_DIR ---"

cat > openssl.cnf <<'EOF'
[ v3_server ]
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth

[ v3_client ]
basicConstraints = CA:FALSE
keyUsage = digitalSignature
extendedKeyUsage = clientAuth
EOF

openssl req -nodes -new -x509 -keyout ca.key -out ca.crt -days 3650 \
  -subj "/CN=Cluster-L2-Bridge-CA"

openssl genrsa -out server.key 2048
openssl req -new -key server.key -out server.csr -subj "/CN=cluster-a-vpn-server"
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out server.crt -days 3650 -extfile openssl.cnf -extensions v3_server

openssl genrsa -out client.key 2048
openssl req -new -key client.key -out client.csr -subj "/CN=cluster-b-vpn-client"
openssl x509 -req -in client.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out client.crt -days 3650 -extfile openssl.cnf -extensions v3_client

openssl dhparam -out dh.pem 2048

echo ""
echo "=== PKI generated ==="
echo ""
echo "Cluster A (server) secrets:"
echo "  oc create secret generic vpn-server-auth \\"
echo "    --from-file=ca.crt=$PKI_DIR/ca.crt \\"
echo "    --from-file=server.crt=$PKI_DIR/server.crt \\"
echo "    --from-file=server.key=$PKI_DIR/server.key \\"
echo "    --from-file=dh.pem=$PKI_DIR/dh.pem \\"
echo "    -n industrial-network"
echo ""
echo "Cluster B (client) secrets:"
echo "  oc create secret generic vpn-client-auth \\"
echo "    --from-file=ca.crt=$PKI_DIR/ca.crt \\"
echo "    --from-file=client.crt=$PKI_DIR/client.crt \\"
echo "    --from-file=client.key=$PKI_DIR/client.key \\"
echo "    -n industrial-network"
