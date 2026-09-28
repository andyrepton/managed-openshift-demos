#!/bin/bash
set -euo pipefail

# Factory Simulator VM — runs as a KVM guest on Hetzner so we don't
# touch the host networking. Creates a lightweight Fedora cloud VM
# with OpenVPN TAP server + bridge + simulated factory device.

# --- Configuration ---
VM_NAME="factory-simulator"
VM_RAM=2048
VM_CPUS=2
VM_DISK=10  # GB
CLOUD_IMAGE_URL="https://download.fedoraproject.org/pub/fedora/linux/releases/41/Cloud/x86_64/images/Fedora-Cloud-Base-Generic-41-1.4.x86_64.qcow2"
WORK_DIR="$(pwd)/factory-vm-assets"
# Host bridge the VM should attach to (the one with external/routable connectivity)
HOST_BRIDGE="${HOST_BRIDGE:-virbr0}"

echo "=== Factory Simulator VM Setup ==="
echo "Host bridge: $HOST_BRIDGE"
echo "Working dir: $WORK_DIR"
echo ""

# --- 1. Generate PKI ---
echo "--- Generating PKI ---"
mkdir -p "$WORK_DIR/pki"
cd "$WORK_DIR/pki"

if [ ! -f ca.crt ]; then
  openssl req -nodes -new -x509 -keyout ca.key -out ca.crt -days 3650 \
    -subj "/CN=Factory-Simulator-CA"

  cat > openssl.cnf <<'SSLEOF'
[ v3_server ]
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth

[ v3_client ]
basicConstraints = CA:FALSE
keyUsage = digitalSignature
extendedKeyUsage = clientAuth
SSLEOF

  openssl genrsa -out server.key 2048
  openssl req -new -key server.key -out server.csr -subj "/CN=factory-vpn-server"
  openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
    -out server.crt -days 3650 -extfile openssl.cnf -extensions v3_server

  openssl genrsa -out client.key 2048
  openssl req -new -key client.key -out client.csr -subj "/CN=rosa-hub-client"
  openssl x509 -req -in client.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
    -out client.crt -days 3650 -extfile openssl.cnf -extensions v3_client

  openssl dhparam -out dh.pem 2048
  echo "PKI generated in $WORK_DIR/pki/"
else
  echo "PKI already exists, skipping generation"
fi

cd "$WORK_DIR"

# --- 2. Download cloud image ---
CLOUD_IMAGE="$WORK_DIR/fedora-cloud-base.qcow2"
if [ ! -f "$CLOUD_IMAGE" ]; then
  echo "--- Downloading Fedora Cloud image ---"
  curl -L -o "$CLOUD_IMAGE" "$CLOUD_IMAGE_URL"
else
  echo "Cloud image already downloaded"
fi

# --- 3. Create VM disk ---
VM_DISK_PATH="$WORK_DIR/${VM_NAME}.qcow2"
echo "--- Creating VM disk ---"
qemu-img create -f qcow2 -b "$CLOUD_IMAGE" -F qcow2 "$VM_DISK_PATH" "${VM_DISK}G"

# --- 4. Build cloud-init ISO ---
echo "--- Building cloud-init ---"
mkdir -p "$WORK_DIR/cloud-init"

cat > "$WORK_DIR/cloud-init/meta-data" <<EOF
instance-id: ${VM_NAME}
local-hostname: ${VM_NAME}
EOF

# Embed certs into cloud-init
CA_CRT=$(base64 -w0 "$WORK_DIR/pki/ca.crt")
SERVER_CRT=$(base64 -w0 "$WORK_DIR/pki/server.crt")
SERVER_KEY=$(base64 -w0 "$WORK_DIR/pki/server.key")
DH_PEM=$(base64 -w0 "$WORK_DIR/pki/dh.pem")

cat > "$WORK_DIR/cloud-init/user-data" <<EOF
#cloud-config
password: factory
chpasswd: { expire: false }
ssh_pwauth: true

write_files:
  - path: /etc/openvpn/server/ca.crt
    encoding: b64
    content: ${CA_CRT}
  - path: /etc/openvpn/server/server.crt
    encoding: b64
    content: ${SERVER_CRT}
  - path: /etc/openvpn/server/server.key
    encoding: b64
    content: ${SERVER_KEY}
    permissions: '0600'
  - path: /etc/openvpn/server/dh.pem
    encoding: b64
    content: ${DH_PEM}
  - path: /etc/openvpn/server/factory.conf
    content: |
      dev tap
      proto udp
      port 1194
      ca /etc/openvpn/server/ca.crt
      cert /etc/openvpn/server/server.crt
      key /etc/openvpn/server/server.key
      dh /etc/openvpn/server/dh.pem
      server-bridge 192.168.100.1 255.255.255.0 192.168.100.10 192.168.100.20
      keepalive 10 120
      cipher AES-256-GCM
      persist-key
      persist-tun
      status /tmp/openvpn-status.log
      verb 3
  - path: /usr/local/bin/setup-factory.sh
    permissions: '0755'
    content: |
      #!/bin/bash
      set -x

      # Wait for OpenVPN to create tap0
      MAX=60; COUNT=0
      while [ \$COUNT -lt \$MAX ]; do
        ip link show tap0 2>/dev/null && break
        sleep 1
        COUNT=\$((COUNT+1))
      done

      # Create the factory bridge and plug in tap0
      ip link add br-factory type bridge 2>/dev/null || true
      ip link set br-factory up
      ip addr add 192.168.100.1/24 dev br-factory 2>/dev/null || true
      ip link set tap0 master br-factory
      ip link set tap0 up
      ip link set tap0 promisc on

      # Simulated factory device — a network namespace with its own
      # MAC and IP on the factory bridge, as if it were a PLC/sensor.
      ip netns add plc-sim 2>/dev/null || true
      ip link add veth-plc type veth peer name veth-br
      ip link set veth-br master br-factory
      ip link set veth-br up
      ip link set veth-plc netns plc-sim
      ip netns exec plc-sim ip addr add 192.168.100.50/24 dev veth-plc
      ip netns exec plc-sim ip link set veth-plc up
      ip netns exec plc-sim ip link set lo up

      echo "=== Factory simulator ready ==="
      echo "  Bridge:  br-factory (192.168.100.1/24)"
      echo "  PLC sim: 192.168.100.50 (netns plc-sim)"
      echo ""
      echo "Test from ROSA hub: ping 192.168.100.1  (bridge)"
      echo "Test from ROSA hub: ping 192.168.100.50 (simulated PLC)"

runcmd:
  - dnf install -y openvpn iproute
  - systemctl stop firewalld || true
  - openvpn --config /etc/openvpn/server/factory.conf --daemon
  - /usr/local/bin/setup-factory.sh
EOF

# Build the cloud-init ISO
genisoimage -output "$WORK_DIR/cloud-init.iso" -volid cidata -joliet -rock \
  "$WORK_DIR/cloud-init/user-data" "$WORK_DIR/cloud-init/meta-data" 2>/dev/null \
  || mkisofs -output "$WORK_DIR/cloud-init.iso" -volid cidata -joliet -rock \
  "$WORK_DIR/cloud-init/user-data" "$WORK_DIR/cloud-init/meta-data"

# --- 5. Launch the VM ---
echo "--- Launching VM ---"
# Destroy existing VM if present
virsh destroy "$VM_NAME" 2>/dev/null || true
virsh undefine "$VM_NAME" 2>/dev/null || true

virt-install \
  --name "$VM_NAME" \
  --ram "$VM_RAM" \
  --vcpus "$VM_CPUS" \
  --disk path="$VM_DISK_PATH",format=qcow2 \
  --disk path="$WORK_DIR/cloud-init.iso",device=cdrom \
  --network bridge="$HOST_BRIDGE" \
  --os-variant fedora-unknown \
  --graphics none \
  --console pty,target_type=serial \
  --noautoconsole \
  --import

echo ""
echo "=== VM '$VM_NAME' is booting ==="
echo ""
echo "Get the VM IP (wait ~30s for DHCP):"
echo "  virsh domifaddr $VM_NAME"
echo ""
echo "SSH in:"
echo "  ssh fedora@<VM_IP>   (password: factory)"
echo ""
echo "Console:"
echo "  virsh console $VM_NAME"
echo ""
echo "--- ROSA setup ---"
echo "Client certs for the ROSA hub are in: $WORK_DIR/pki/"
echo ""
echo "Create the ROSA secrets with:"
echo "  oc create secret generic factory-vpn-auth \\"
echo "    --from-file=ca.crt=$WORK_DIR/pki/ca.crt \\"
echo "    --from-file=client.crt=$WORK_DIR/pki/client.crt \\"
echo "    --from-file=client.key=$WORK_DIR/pki/client.key \\"
echo "    -n industrial-network"
echo ""
echo "Then update vpn-auth-secret.yaml: set 'remote' to the VM's IP"
echo "and apply it to the cluster."
