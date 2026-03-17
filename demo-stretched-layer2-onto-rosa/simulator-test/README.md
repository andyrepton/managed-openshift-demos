# Test folder

## Generate keys and certs

# 1. Create the CA (The root of trust)
openssl req -nodes -new -x509 -keyout ca.key -out ca.crt -days 365 -subj "/CN=Industrial-Lab-CA"

# 2. Create the Server Key/Cert (For the "Factory Simulator" Pod)
openssl genrsa -out server.key 2048
openssl req -new -key server.key -out server.csr -subj "/CN=vpn-server"
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out server.crt -days 365

# 3. Create the Client Key/Cert (For your "Hub" Pod)
openssl genrsa -out client.key 2048
openssl req -new -key client.key -out client.csr -subj "/CN=hub-client"
openssl x509 -req -in client.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out client.crt -days 365

# 4. Generate Diffie-Hellman parameters (Required for the server)
openssl dhparam -out dh.pem 2048

## Set up the factory simulator

```
oc create namespace factory-simulator
oc create secret generic simulator-vpn-server-auth \
  --from-file=ca.crt=ca.crt \
  --from-file=server.crt=server.crt \
  --from-file=server.key=server.key \
  --from-file=dh.pem=dh.pem \
  -n factory-simulator
```

`oc apply -f factory-simulator.yaml`
