# Graviton demo

## Ahead of time

- Ensure you've built a cluster than has Graviton nodes. You can use the terraform in ../andys-demo-cluster-tf to achieve this 

- Clean up your existing demo:

```
$ oc delete namespace multiarch-demo-proj
```

## During the demo

- Talk about showing off our hello source2image option.

- Deploy hello to a new namespace, go to developer view in the console and click Add, then Import from git, choose https://github.com/andyrepton/hello as the source. Show it running.

- Explain that we can now deploy this on different nodes, including Graviton. We'll start by making a namespace:

```
$ oc apply -f namespace.yaml

$ oc project multiarch-demo
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

We can check it's worked using:

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
