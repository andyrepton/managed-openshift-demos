# Build the Podman container
podman build -t my-ldap-server .

# Run the Podman container
podman run -d -p 1389:389 my-ldap-server
