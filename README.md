# Managed OpenShift Demos

This repository provides a collection of "solution-based" demonstrations for Managed OpenShift environments (ROSA and ARO).

In a managed environment, the cloud provider and Red Hat handle the cluster's lifecycle. These demos focus on what you can build **on top** of the platform once the operational burden of the infrastructure is removed.

-----

## 🚀 Demo Categories

### Infrastructure & Scaling

  * **[AutoNode on ROSA](./demo-autonode-on-rosa):** Use Karpenter-based scaling to dynamically provision "right-sized" EC2 instances.

### AWS Integration & Modernization

  * **[S3 Buckets via ACK](./demo-deploy-s3-buckets-with-ack):** Provision AWS S3 buckets directly from OpenShift using the AWS Controllers for Kubernetes (ACK).
  * **[CloudWatch Logging](./demo-forward-logs-to-aws-cloudwatch):** Forward OpenShift cluster and application logs to AWS CloudWatch.
  * **[CloudWatch Metrics](./demo-forward-metrics-to-aws-cloudwatch):** Export cluster metrics to AWS for centralized monitoring.

### Application Services & Networking

  * **[Service Mesh App Deployment](./demo-deploying-an-app-with-service-mesh):** Deploy a microservices application integrated with OpenShift Service Mesh.

### Developer Experience

  * **[Red Hat Dev Spaces](./openshift-devspaces):** Set up cloud-native IDEs for consistent development environments.

-----

## 🛠️ General Prerequisites

While each demo has its own specific requirements, you will generally need:

1.  An active **ROSA** or **ARO** cluster.
2.  The `oc` CLI tool.
3.  The `rosa` or `az` CLI (depending on the provider).
4.  `terraform` (for infrastructure-based demos).

## Terraform pre-start

The `andys-demo-cluster-tf` folder has my working terraform code to build `rosa` and `aro` clusters, which can be used as a baseline

## 🤝 Contributing

This is an ever-growing repository. If you find a bug or have a suggestion for a new demo:

1.  **Open an Issue:** To report bugs or request features.
2.  **Submit a PR:** Contributions are welcome\! Please ensure your demo includes a README following the established friendly, technical style.

-----

*Maintained by [Andy Repton](https://github.com/andyrepton)*
*Some README files in this repository have been generated and/or edited by Gemini. All code has been created by the author*
