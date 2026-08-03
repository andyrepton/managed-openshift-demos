# Managed OpenShift Demos

This repository provides a collection of "solution-based" demonstrations for Managed OpenShift environments (ROSA and ARO).

In a managed environment, the cloud provider and Red Hat handle the cluster's lifecycle. These demos focus on what you can build **on top** of the platform once the operational burden of the infrastructure is removed.

-----

## Demo Categories

### Infrastructure & Scaling

* **[AutoNode on ROSA](./demo-autonode-on-rosa):** Karpenter-based dynamic node provisioning for ROSA HCP.
* **[Graviton on ROSA](./demo-graviton-on-rosa):** Multi-architecture builds and ARM64/Graviton node deployment.
* **[Multi-Region ROSA](./demo-multi-region-rosa):** Multi-region failover with Route53 and Global Accelerator.
* **[Stretched Layer 2 onto ROSA](./demo-stretched-layer2-onto-rosa):** Bridge factory-floor L2 protocols to VMs on ROSA via VXLAN/VPN.

### AWS Integration

* **[S3 Buckets via ACK](./demo-deploy-s3-buckets-with-ack):** Kubernetes-native S3 bucket provisioning with AWS Controllers for Kubernetes.
* **[CloudWatch Metrics](./demo-forward-metrics-to-aws-cloudwatch):** Export Prometheus metrics to AWS CloudWatch dashboards.

### Observability & Logging

* **[OpenShift Logging with LokiStack](./demo-openshift-logging):** Deploy LokiStack-based logging on ROSA.
* **[Multi-Namespace Log & Metrics Forwarding](./demo-multi-namespace-log-metrics-forwarding):** Per-team log/metrics forwarding to New Relic using COO and OpenTelemetry.

### Virtualization & Migration

* **[Deploy a VM with OpenShift Virt](./demo-deploying-a-vm-with-openshift-virt):** VM lifecycle management on managed OpenShift.
* **[OpenShift Virt on OSD (GCP)](./demo-openshift-virt-on-osd):** OpenShift Virtualization on bare-metal GCP instances.
* **[Multi-Cloud VM Migration (MTV)](./demo-mtv-migration-multi-cloud):** Cross-cluster VM migration with the Migration Toolkit for Virtualization.

### AI & Machine Learning

* **[OpenShift AI on ROSA](./demo-openshift-ai-on-rosa):** GPU-accelerated object detection model serving with RHOAI.
* **[Model as a Service (MaaS)](./demo-maas-on-rosa):** LLM inference via OpenAI-compatible MaaS API.
* **[GitLab Duo on ROSA](./demo-gitlab-duo-on-rosa):** GitLab + Duo AI code assistant with in-cluster LLM serving.

### Developer Experience & GitOps

* **[Segregated GitOps](./demo-deploying-segregated-gitops):** Per-team ArgoCD instances managed by a central platform team.
* **[Source-to-Image & Dev Spaces](./demo-source2image):** Build and deploy from source with S2I and browser-based IDEs.
* **[Service Mesh App Deployment](./demo-deploying-an-app-with-service-mesh):** Enroll applications in OpenShift Service Mesh.

### Deprecated

* **[Cluster Logging with Elasticsearch](./demo-deploying-cluster-logging-with-elasticsearch):** _(Deprecated)_ Legacy EFK stack. See [OpenShift Logging](./demo-openshift-logging) instead.
* **[Forward Logs to CloudWatch](./demo-forward-logs-to-aws-cloudwatch):** _(Deprecated)_ Legacy log forwarding with Fluentd. See [OpenShift Logging](./demo-openshift-logging) instead.

### Work in Progress

* **[Continue on ROSA](./demo-continue-on-rosa):** AI code assistant integration (WIP).
* **[GitLab on OpenShift](./demo-gitlab-on-openshift):** Basic GitLab operator deployment (WIP -- see [GitLab Duo on ROSA](./demo-gitlab-duo-on-rosa) for a complete setup).
* **[OpenShift Virt on ROSA](./demo-openshift-virt-on-rosa):** OpenShift Virtualization on ROSA (WIP).

-----

## General Prerequisites

While each demo has its own specific requirements, you will generally need:

1.  An active **ROSA** or **ARO** cluster.
2.  The `oc` CLI tool.
3.  The `rosa` or `az` CLI (depending on the provider).
4.  `terraform` (for infrastructure-based demos).

## Terraform Pre-start

The `andys-demo-cluster-tf` folder has working Terraform code to build ROSA and ARO clusters, which can be used as a baseline. See the `.tfvars` files for preset configurations:

* `basic_rosa.tfvars` -- ROSA HCP cluster only.
* `basic_aro.tfvars` -- ARO cluster only.
* `ai_rosa.tfvars` -- ROSA with AI/GPU machine pool enabled.

## Contributing

This is an ever-growing repository. If you find a bug or have a suggestion for a new demo:

1.  **Open an Issue:** To report bugs or request features.
2.  **Submit a PR:** Contributions are welcome! Please ensure your demo includes a README following the established style.

-----

*Maintained by [Andy Repton](https://github.com/andyrepton)*
*Some README files in this repository have been generated and/or edited by AI assistants. All code has been created by the author.*
