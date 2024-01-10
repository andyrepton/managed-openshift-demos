# Hello world demo for OpenShift - source2image

## Instructions:

> Things marked like this are things to do

* Things marked like this are things you can say during your demo

## Demo

> Show the App:

https://github.com/andyrepton/hello

* Talk about how we're going to go from code to deployment without needing to worry about containerisation, images, Kubernetes or anything else

Create a new project:

```
oc new-project s2i-demo
```

* Here we'll ask our cluster to take our code and deploy it as an application

```
oc new-app golang~https://github.com/andyrepton/hello.git
```

* Our cluster is compiling the golang code directly into an image, and pushing it to our internal registry

``
oc logs -f buildconfig/hello
``

* Now we want to see our code in the wild, let's make it available

```
oc expose deployment hello --port 8080
oc expose service/hello
```

* Oh dear, it looks like we've not added an https certificate, which is not ideal. Let's ask our cluster to fix that for us

```
oc delete route hello
oc create route edge --service=hello
```

* Much better, now we have a fully secured App ready in less than a few minutes, and without needing to edit anything apart from my code.

* However, let's take this to the next level, and talk about Dev Spaces

> Open up Dev Spaces link and click on create dev space

> Here we'll just paste in our link to our code
https://github.com/andyrepton/hello.git

* Now, let's make an edit to our code, right here inside our OpenShift Dev Space

- Edit code to show a new message
- Go to: Top left - Terminal

* Now we'll again ask the cluster to set up a new build pipeline for us

```
oc new-build --binary --image-stream openshift/golang --name demo --strategy source 
```

* And once that is set up, we can start a new build of our code:

```
oc start-build demo --from-dir=. --follow
```

* Let's see our new image that's been built in our build pipeline:

```
oc get imagestream demo
oc new-app --name demo ${image_name}

oc expose deployment/demo --port 8080
oc create route edge --service=demo
```

> Get the new route

```
oc get route demo
```

> Open the page

* But now, it's even simpler to make changes to our code and see them reflected in real time. Let's edit our code again and trigger our built in CI pipeline!

> Edit the code again

```
oc start-build demo --from-dir=. --follow
```

> Refresh the page and show the code has updated without any other changes

* As you can see, now our CI pipeline is set up, we can rapidly iterate and test our code without needing to set up multiple other tools and systems. Our Application Platform is taking care of everything for us
