# GPU pool scaler for ROSA HCP.
#
# The rosa CLI binary is a statically linked ELF, so no libc is needed and a
# minimal UBI image is enough. We need jq to parse `rosa list machinepools
# --output json` for the polling/verification logic.
FROM registry.redhat.io/ubi9/ubi:latest

ARG ROSA_VERSION=1.2.61

RUN microdnf install -y jq && microdnf clean all

RUN curl -fsSL "https://github.com/openshift/rosa/releases/download/v${ROSA_VERSION}/rosa_Linux_x86_64.tar.gz" \
    | tar -xz -C /tmp && \
    mv /tmp/rosa /usr/local/bin/rosa && \
    rm -f /tmp/rosa

COPY --chown=ubi:0 scale.sh /usr/local/bin/scale.sh
RUN chmod 755 /usr/local/bin/scale.sh

ENTRYPOINT ["/usr/local/bin/scale.sh"]