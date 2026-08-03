# GitLab on OpenShift

> **Status: Work in Progress** -- This demo is under active development and is not yet ready for use.

This demo will cover a minimal GitLab deployment on OpenShift using the GitLab Operator and a custom `IngressClass` for the GitLab NGINX ingress controller.

## Current Contents

* `gitlab-operator.yaml` -- Placeholder for the GitLab Operator subscription (currently empty).
* `ingress-class.yaml` -- `IngressClass` resource for `k8s.io/ingress-nginx` named `gitlab-nginx`.

## Complete Alternative

For a fully documented GitLab setup including GitLab Duo AI code assistant, GPU-backed model serving, and Dev Spaces integration, see [GitLab Duo on ROSA](../demo-gitlab-duo-on-rosa).
