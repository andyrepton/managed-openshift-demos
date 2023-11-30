# Demo 5: Red Hat Interconnects (skupper)

## Before you run your demo
This requires two clusters to function correctly and only openshift clusters are currently supported.

If you are running the demo a number of times the access details can be populated in the file demo5/demo5_config.txt an example of which can be found in the demo5 folder. You can also just copy and paste the values in when the script asks. git ignore rules will prevent the demo5_config.txt file from getting added or pushed to the repo

To start the demo:-

- Run `./create_demo.sh install_demo5`

## During your demo

1. Explain that you have two separate clusters, only cluster 1 needs to have public ingress, to allow the users to access the front end web site. Cluster two will contain the details for the site and also have the service that will allow people to pay their bills.
2. The script will log into the first cluster, create the namespace "patient-portal-frontend" and deploy the "patient-portal-frontend" application, once deployed it will then create a route into the app. The blue text that is shown is the URL to access the web of the application. The script will await your input so you can grab the URL and talk through what has happened so far, show the webpage.
3. Script now logs into the "private" cluster. It creates a namespace called private and it deploys patient-portal-database into this namespace. Once the deployment has been completed successfully The services are shown that show no external ip addresses have been applied then the routes are shown to to confirm no routes have been created. The script pauses to allow these facts to be shown.
4. On the same cluster, in the same namespace, the script now deploys the payment-processor application. Once again, when available the svc details are shown, to confirm no external IP addresses have been applied, and the routes are shown, to confirm that nothing has been created. The script pauses to allow all this information to be shown.
5. Now is a goo opportunity to show all of this through the clusters web interfaces if you so wish.
6. The script now logs back into the 1st cluster and the "patient-portal-frontend" namespace. It now installs the skupper, enabling the UI with no auth and enabling the flow collector. Once installation is complete skupper status is called. This will output in blue text giving the namespace its installed in and that it has no exposed services. It will then give you the URL for the console. Script will once again pause to allow you to demo the UI.
7. Skupper is now installed as an ingress in router mode on the private cluster, once finished the skupper status command is called. Output is in blue text highlighting that its enabled in edge mode and has no exposed services
8. We now get the frontend skupper service to create a token that will contain all thats required to securely connect the backend services without the need to open any ports. While the connection between the two is made, the link isnt yet enabled, as can be seen on the screen