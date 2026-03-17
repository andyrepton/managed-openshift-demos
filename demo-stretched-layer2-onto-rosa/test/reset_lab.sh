#!/bin/bash

# 1. Configuration
HUB_NS="industrial-network"
SIM_NS="factory-simulator"
IMAGE="image-registry.openshift-image-registry.svc:5000/${HUB_NS}/industrial-network-tools:latest"

echo "--- 1. Generating Fresh PKI (Certs) ---"
# Create CA
openssl req -nodes -new -x509 -keyout ca.key -out ca.crt -days 3650 -subj "/CN=Industrial-Lab-CA"

# Create Extension Config
cat <<EOF > openssl.cnf
[ v3_server ]
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth

[ v3_client ]
basicConstraints = CA:FALSE
keyUsage = digitalSignature
extendedKeyUsage = clientAuth
EOF

# Create Server Cert
openssl genrsa -out server.key 2048
openssl req -new -key server.key -out server.csr -subj "/CN=vpn-server"
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out server.crt -days 3650 -extfile openssl.cnf -extensions v3_server

# Create Client Cert
openssl genrsa -out client.key 2048
openssl req -new -key client.key -out client.csr -subj "/CN=hub-client"
openssl x509 -req -in client.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out client.crt -days 3650 -extfile openssl.cnf -extensions v3_client

# Create DH Param
openssl dhparam -out dh.pem 2048

echo "--- 2. Cleaning Namespaces ---"
oc delete secret factory-vpn-auth -n $HUB_NS --ignore-not-found
oc delete secret simulator-vpn-server-auth simulator-vpn-config -n $SIM_NS --ignore-not-found
oc delete deployment industrial-hub -n $HUB_NS --ignore-not-found
oc delete deployment vpn-server-simulator -n $SIM_NS --ignore-not-found

echo "--- 3. Creating Simulator Secrets & Deployment ---"
oc create secret generic simulator-vpn-server-auth \
  --from-file=ca.crt=ca.crt --from-file=server.crt=server.crt \
  --from-file=server.key=server.key --from-file=dh.pem=dh.pem -n $SIM_NS

oc create secret generic simulator-vpn-config -n $SIM_NS \
  --from-literal=server.conf="dev tap
proto udp
port 1194
ca /etc/openvpn/certs/ca.crt
cert /etc/openvpn/certs/server.crt
key /etc/openvpn/certs/server.key
dh /etc/openvpn/certs/dh.pem
server-bridge 192.168.100.1 255.255.255.0 192.168.100.10 192.168.100.20
keepalive 10 120
cipher AES-256-GCM
persist-key
persist-tun
status /tmp/openvpn-status.log
verb 3"

# Apply Simulator Deployment (Using your internal image)
cat <<EOF | oc apply -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: vpn-server-simulator
  namespace: $SIM_NS
spec:
  replicas: 1
  selector:
    matchLabels:
      app: vpn-server
  template:
    metadata:
      labels:
        app: vpn-server
    spec:
      serviceAccountName: simulator-admin
      containers:
      - name: vpn-server
        image: $IMAGE
        securityContext:
          privileged: true
        args: ["/bin/sh", "-c", "openvpn --config /etc/openvpn/config/server.conf"]
        volumeMounts:
        - name: vpn-certs
          mountPath: /etc/openvpn/certs
        - name: vpn-config
          mountPath: /etc/openvpn/config
      volumes:
      - name: vpn-certs
        secret:
          secretName: simulator-vpn-server-auth
      - name: vpn-config
        secret:
          secretName: simulator-vpn-config
EOF

echo "--- 4. Creating Hub Secrets & Deployment ---"
oc create secret generic factory-vpn-auth -n $HUB_NS \
  --from-file=ca.crt=ca.crt --from-file=client.crt=client.crt \
  --from-file=client.key=client.key \
  --from-literal=client.conf="client
dev tap
proto udp
remote vpn-server-svc.${SIM_NS}.svc.cluster.local 1194
resolv-retry infinite
nobind
persist-key
persist-tun
ca /etc/openvpn/certs/ca.crt
cert /etc/openvpn/certs/client.crt
key /etc/openvpn/certs/client.key
remote-cert-tls server
cipher AES-256-GCM
verb 3
status /tmp/openvpn-status.log"

# Apply Hub Deployment
cat <<EOF | oc apply -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: industrial-hub
  namespace: $HUB_NS
spec:
  replicas: 1
  selector:
    matchLabels:
      app: industrial-hub
  template:
    metadata:
      labels:
        app: industrial-hub
    spec:
      hostNetwork: true
      serviceAccountName: industrial-admin
      containers:
      - name: gateway
        image: $IMAGE
        securityContext:
          privileged: true
        command: ["/bin/sh", "-c"]
        args:
          - |
            ip link add br-hub type bridge
            ip link set br-hub up
            openvpn --config /etc/openvpn/config/client.conf --daemon
            until ip link show tap0; do sleep 2; done
            ip link set tap0 master br-hub
            ip link set tap0 up
            echo 'HUB READY'
            tail -f /dev/null
        volumeMounts:
        - name: vpn-certs
          mountPath: /etc/openvpn/certs
        - name: vpn-config
          mountPath: /etc/openvpn/config
      volumes:
      - name: vpn-certs
        secret:
          secretName: factory-vpn-auth
      - name: vpn-config
        secret:
          secretName: factory-vpn-auth
EOF

echo "--- DONE. Watch logs with: oc logs -f deployment/industrial-hub -n $HUB_NS ---"
