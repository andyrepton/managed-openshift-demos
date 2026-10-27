# demo-rhdh-devspaces-self-service

## RHDH identity is not cluster identity

RHDH signs in with GitHub, but Dev Spaces derives a user's namespace from the
**OpenShift** username. If the two differ (for example a ROSA cluster using
htpasswd), a namespace the plugin creates as `<github-login>-devspaces` is one
Che never looks in: the user logged in as `cluster-admin` gets
`cluster-admin-devspaces`, and the workspace exists but is invisible to them.
Make the cluster username match the GitHub login (for example an htpasswd entry
for it). RHDH 2.x's OpenShift auth plugin removes the mismatch.

On ROSA HCP, manage htpasswd users through OCM or the `rosa` CLI, never the
`OAuth` CR (its `.spec` is empty; the OAuth server is in the managed control
plane). After a password change, logins return 401 for a minute or two until it
propagates.

A Che-provisioned namespace carries two RoleBindings to the user
(`openshift-operators-cheworkspaces-clusterrole` and
`...-cheworkspaces-devworkspace-clusterrole`) that a plugin-created one does
not. If a workspace exists but the user cannot see or start it, check those
first.
