# Graviton demo

## Ahead of time

- 

$ oc delete namespace multiarch-demo

## During the demo

- Talk about showing off our hello source2image option.

- Deploy hello to a new namespace

$ oc apply -f namespace.yaml

$ oc project multiarch-demo

$ oc apply -f image-stream.yaml

$ oc import-image golang:1.18-ubi8 --confirm --import-mode="PreserveOriginal" -n openshift

$ oc apply -f amd64-build-config.yaml

$ oc apply -f arm64-build-config.yaml

$ oc get builds
NAME            TYPE     FROM          STATUS     STARTED          DURATION
hello-amd64-1   Source   Git@77d7d85   Complete   25 seconds ago   24s
hello-arm64-1   Source   Git@77d7d85   Running    21 seconds ago

$ oc get imagestreamtags
NAME          IMAGE REFERENCE                                                                                                                                 UPDATED
hello:amd64   image-registry.openshift-image-registry.svc:5000/multiarch-demo/hello@sha256:030d1bb5db80527b81828a9d332a7ea0181d76b6f07fc53c89c55045066073a4   11 seconds ago
hello:arm64   image-registry.openshift-image-registry.svc:5000/multiarch-demo/hello@sha256:474a8019bcc62b5310f9e482290030ac42467921703ef8189e4857a553ff54c0   8 seconds ago

 $ oc apply -f deployments.yaml

$ oc apply -f services.yaml

$ oc apply -f routes.yaml

$ oc get pods -l deployment=hello -o json | jq '.items[] | .metadata.name + " | " + .spec.nodeName'

$ for NODE in $(oc get pods -l deployment=hello -o json | jq -r '.items[] | .spec.nodeName'); do oc get node $NODE -o json | jq .status.nodeInfo.architecture; done
