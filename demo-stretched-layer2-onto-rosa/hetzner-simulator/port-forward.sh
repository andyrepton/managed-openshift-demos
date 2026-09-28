#!/bin/bash
set -euo pipefail

# Run this on the Hetzner HOST to forward UDP 1194 from the public IP
# to the factory simulator VM. Only needed if the VM is on a NAT bridge.
#
# If the VM is directly on a routable bridge (e.g., a public subnet bridge),
# skip this and point ROSA directly at the VM's IP.

VM_IP="${1:-}"
if [ -z "$VM_IP" ]; then
  echo "Usage: $0 <factory-vm-ip>"
  echo ""
  echo "Get the VM IP with: virsh domifaddr factory-simulator"
  exit 1
fi

HOST_IF=$(ip route | grep default | awk '{print $5}' | head -n1)

echo "Forwarding UDP 1194: $HOST_IF -> $VM_IP"

# Enable forwarding
sysctl -w net.ipv4.ip_forward=1

# Forward UDP 1194 to the VM
iptables -t nat -A PREROUTING -i "$HOST_IF" -p udp --dport 1194 \
  -j DNAT --to-destination "$VM_IP":1194
iptables -t nat -A POSTROUTING -p udp -d "$VM_IP" --dport 1194 \
  -j MASQUERADE

echo "Done. ROSA hub should connect to this host's public IP on UDP 1194."
echo ""
echo "To remove later:"
echo "  iptables -t nat -D PREROUTING -i $HOST_IF -p udp --dport 1194 -j DNAT --to-destination $VM_IP:1194"
echo "  iptables -t nat -D POSTROUTING -p udp -d $VM_IP --dport 1194 -j MASQUERADE"
