# Demo 4: Integrating ROSA with AWS Secrets Manager

## Before your demo

- Run `./create_demo.sh install_demo4

## During your demo

1. Explain that you are using ROSAs built in STS mode to generate short term credentials to access secrets manager
2. Create your secret using:

```
aws --region "$REGION" secretsmanager create-secret \
  --name MySecret --secret-string \
  '{"username":"shadowman", "password":"hello-world"}' \
  --query ARN --output text
```

3. Set the SECRET_ARN variable using the output of the above command:

```
export SECRET_ARN=$value_from_above
```

4. Explain you will create a policy that will only allow access to this particular secret. Create the policy document using:

```
cat << EOF > policy.json
{
  "Version": "2012-10-17",
  "Statement": [{
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue",
        "secretsmanager:DescribeSecret"
      ],
      "Resource": ["$SECRET_ARN"]
      }]
}
EOF
```

5. Create the policy allowing access to this secret, making sure you set the CLUSTER variable first (this should be already set in your shell if you used the create_demo.sh script)

```
POLICY_ARN=$(aws --region "$REGION" --query Policy.Arn \
  --output text iam create-policy \
  --policy-name ${CLUSTER}-access-to-my-secret \
  --policy-document file://policy.json)
```

6. Deploy an application to read your secret:

```
cat << EOF | oc apply -n csi-driver-demo -f -
apiVersion: v1
kind: Pod
metadata:
  name: my-application
  labels:
    app: my-application
spec:
  volumes:
  - name: secrets-store-inline
    csi:
      driver: secrets-store.csi.k8s.io
      readOnly: true
      volumeAttributes:
        secretProviderClass: "my-application-aws-secrets"
  containers:
  - name: my-application-deployment
    image: k8s.gcr.io/e2e-test-images/busybox:1.29
    command:
      - "/bin/sleep"
      - "10000"
    volumeMounts:
    - name: secrets-store-inline
      mountPath: "/mnt/secrets-store"
      readOnly: true
EOF
```

7. Exec into your pod to show the secret to your audience:

```
oc exec -n csi-driver-demo -it my-application -- cat /mnt/secrets-store/MySecret
```
