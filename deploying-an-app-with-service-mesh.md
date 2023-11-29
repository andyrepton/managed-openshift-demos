# Demo 5: deploying an application with service mesh

## Before your demo

1. Install service mesh by following the instructions in the `openshift-service-mesh` folder

## During your demo

1. Deploy the hello applicationo

```bash
oc new-project hello
oc new-app https://github.com/andyrepton/hello
```

2. Create a service mesh roll using the example here:

```bash
oc apply -f deploying-an-app-with-service-mesh/servicemeshroll.yaml
```
