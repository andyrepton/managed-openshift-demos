# Prep for Source2Image demo

## Install devspaces

Go to ../openshift-devspaces and follow the instructions there

## Cleanup
oc project s2i-demo
oc delete buildconfig demo
oc delete deployment demo
oc delete imagestream demo
oc delete service demo
oc delete route demo
oc delete project s2i-demo

# Cleanup Dev Space

- Go to Dev Spaces
- Click Create WorkSpace
- Put in your github repo: https://github.com/andyrepton/hello (this is to pre-warm the pulling of the workspace images, which can take up to 5 minutes on the first go)

- Go to Dev Spaces
- Click on WorkSpaces
- Delete workspace
