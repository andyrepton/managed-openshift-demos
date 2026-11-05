# Graviton demo

This demo runs the same application on x86 (AMD64) and AWS Graviton (ARM64)
worker nodes in one Red Hat OpenShift Service on AWS (ROSA) cluster. Two
OpenShift source-to-image builds compile a sample Go app from the same Git
repository, one per architecture, into one image stream with `amd64` and `arm64`
tags; node selectors place each deployment on the matching nodes, and each app's
route shows the architecture it runs on. Developers do no extra work to target
ARM. It is here to show that ROSA supports mixed-architecture clusters.

Tested: 2026-11-05, ROSA HCP 4.22.12 with one m6g.xlarge Graviton node (the console Import from Git step was not run).

## Ahead of time

- Ensure you've built a cluster that has Graviton nodes: apply
  [andys-demo-cluster-tf](../andys-demo-cluster-tf) with
  `deploy_graviton_machine_pool = true`. Check one is Ready:

```
$ oc get nodes -l kubernetes.io/arch=arm64
```

- If you have run the demo before on this cluster, run [Clean Up](#clean-up) first.

## During the demo

- Talk about showing off our hello source2image option.

- Deploy hello to a new namespace: in the console's developer view click Add, then Import from Git, and use https://github.com/andyrepton/hello as the source. Show it running.

- Explain that we can now deploy this on different nodes, including Graviton. We'll start by making a namespace:

```
$ oc apply -f namespace.yaml

$ oc project multiarch-demo-proj
```

Now, we will make an image stream that will hold our multi-arch builds:

```
$ oc apply -f image-stream.yaml
```

Our base image that is used to build the image is the golang.1.18 UBI 8 image. By default, our cluster will only have the AMD64 version of this, so let's now go and sync the other arch's from Red Hat's upstream registries. We can do this by running the following:

```
$ oc import-image golang:1.18-ubi8 --confirm --import-mode="PreserveOriginal" -n openshift
```

Now that's done, let's make two build configs, one for AMD64 and one for ARM64. This will build our image on the correct nodes and tag them.

```
$ oc apply -f amd64-build-config.yaml

$ oc apply -f arm64-build-config.yaml
```

We can check it's worked using (each build takes about a minute):

```
$ oc get builds
NAME            TYPE     FROM          STATUS     STARTED          DURATION
hello-amd64-1   Source   Git@77d7d85   Complete   25 seconds ago   24s
hello-arm64-1   Source   Git@77d7d85   Running    21 seconds ago
```

And now we should see our two tags:

```
$ oc get imagestreamtags
NAME          IMAGE REFERENCE                                                                                                                                 UPDATED
hello:amd64   image-registry.openshift-image-registry.svc:5000/multiarch-demo/hello@sha256:030d1bb5db80527b81828a9d332a7ea0181d76b6f07fc53c89c55045066073a4   11 seconds ago
hello:arm64   image-registry.openshift-image-registry.svc:5000/multiarch-demo/hello@sha256:474a8019bcc62b5310f9e482290030ac42467921703ef8189e4857a553ff54c0   8 seconds ago
```

Let's make two deployments, one for ARM, and one for AMD:

```
$ oc apply -f deployments.yaml
```

And expose them to the internet:

```
$ oc apply -f services.yaml
$ oc apply -f routes.yaml
$ oc rollout status deploy/hello-amd64
$ oc rollout status deploy/hello-arm64
```

- Now go back to the console and open up the apps in new tabs. You should see the architecture has changed between the two, showing that the same app is running on different nodes and different arch types, with no additional work needed from the developer side.

We can see now which nodes our deployments are on:

```
$ oc get pods -l deployment=hello -o json | jq '.items[] | .metadata.name + " | " + .spec.nodeName'
```

Now we can show the arch types of the nodes:

```
$ for NODE in $(oc get pods -l deployment=hello -o json | jq -r '.items[] | .spec.nodeName'); do oc get node $NODE -o json | jq .status.nodeInfo.architecture; done
```

And from the command line, each route's page names the architecture it runs on:

```
$ for r in hello-amd64 hello-arm64; do echo "$r: $(curl -s https://$(oc get route $r -o jsonpath='{.spec.host}')/ | grep -io 'arm64\|amd64' | sort -u)"; done
hello-amd64: amd64
hello-arm64: arm64
```

## Clean Up

```
$ oc delete namespace multiarch-demo-proj
```

The project created through the console in the first step is separate; delete
it the same way if you no longer need it.
