---
title: "Service Account Tokens in Kubernetes v1.24"
date: 2022-08-18T16:50:39+01:00
authors: ["jdyson"]
tags: ["kubernetes", "security"]
slug: service-account-tokens-in-kubernetes-v1.24
feature_image: who-are-you.jpg
excerpt: |
  With Kubernetes v1.24, non-expiring service account tokens are no longer auto-generated.
  This blog post highlights what this means in practice, and what to do if you rely on non-expiring
  service account tokens.
description: |
  With Kubernetes v1.24, non-expiring service account tokens are no longer auto-generated. Learn what
  these changes bring and what to do if you rely on non-expiring service account tokens.
---

## What is a service account token?

Service accounts are a critical part of Kubernetes, providing an identity for processes that run in a pod. To provide
that identity to a pod, a service account token is mounted into each pod by default. You can disable this feature via
both [service account][disable sa token] and [pod][disable pod sa token] configuration.

A process can authenticate to the Kubernetes API server by using the service account token as a
[bearer token][bearer token] in any requests by including the token in the `Authorization` header like
`Authorization: Bearer <TOKEN>`. The API server will verify the provided token by using the keys specified in the
`--service-account-key-file` flag. Note that multiple keys and files can be provided here which allows for multiple
issuers and/or signing key rotation.

After the token is verified, the API server extracts the identity from the token and applies the configured [RBAC][rbac]
policy to the request.

## What does a service account token look like?

Let's take a look at a service account token in a running pod. If you don't have a cluster handy, spin up a
cluster with [KinD][kind]. First, use a v1.24 cluster and see what a token mounted into a pod looks like:

```bash
$ kind create cluster --name=sa-token-demo-v1.24 --image kindest/node:v1.24.3
```

Now let's spin up a simple workload and take a look at the mounted token:

```bash
$ kubectl --context kind-sa-token-demo-v1.24 run \
  --restart=Never busybox -it \
  --image=busybox --rm --quiet -- \
  cat /var/run/secrets/kubernetes.io/serviceaccount/token

eyJhbGciOiJSUzI1NiIsImtpZCI6IndNVTRHT3N1cVBuRmpQYXI3TmFaWlRFbU5sYzJJX1c3NWZhRURiTEI3ZEkifQ.eyJhdWQiOlsiaHR0cHM6Ly9rdWJlcm5ldGVzLmRlZmF1bHQuc3ZjLmNsdXN0ZXIubG9jYWwiXSwiZXhwIjoxNjkyNDQ1NzQxLCJpYXQiOjE2NjA5MDk3NDEsImlzcyI6Imh0dHBzOi8va3ViZXJuZXRlcy5kZWZhdWx0LnN2Yy5jbHVzdGVyLmxvY2FsIiwia3ViZXJuZXRlcy5pbyI6eyJuYW1lc3BhY2UiOiJkZWZhdWx0IiwicG9kIjp7Im5hbWUiOiJidXN5Ym94IiwidWlkIjoiZDgyMmJhNWYtNDI5MC00YmNhLTk0Y2UtZjNiYzBkY2EyZTM2In0sInNlcnZpY2VhY2NvdW50Ijp7Im5hbWUiOiJkZWZhdWx0IiwidWlkIjoiODIwOGZmNTYtMGE2Ny00N2JiLTgxNzUtYTE5ODQyM2RhY2Y4In0sIndhcm5hZnRlciI6MTY2MDkxMzM0OH0sIm5iZiI6MTY2MDkwOTc0MSwic3ViIjoic3lzdGVtOnNlcnZpY2VhY2NvdW50OmRlZmF1bHQ6ZGVmYXVsdCJ9.HYpdLtzZfJYSlI7UQpT1rT_2LbZpP33-PDcQe_9MtuCjRUnexEQUlBN7_VdXIRMEhHEM3MxiHmTjUFmLo_vW0o_6ovTG8d32iudCUpXUJ0cQ0oV6qti8QAHBBP-4GFH2x6vGu1awk3kp20ahIfdS3q56e4p7mmjKlZPsUTdHWBqgff84O1u5yrG5gDM02QkedPLBB-6DmNFpGDoy8GXOMr145Iai_2HkWsumY9Ol2lXR7uHBqy85K4P9mhwRK_BfKmiCiV99Tcr6wgbBlywOQdVwWVnB6eoNzdLm4tXt2ZD5xRKiD54yNIoPWUiA_0-R8fPXcsjsLPPHAqVNjW4Hxg
```

The token is a `JSON Web Token` (`JWT`), encoded as base64 as specified in the [JWT RFC][jwt rfc]. [`jwt.io`][jwt.io]
is a useful tool to decode JWT. If we paste in the encoded JWT and inspect the token payload, it will look similar to the
following:

```json
{
  "aud": [
    "https://kubernetes.default.svc.cluster.local"
  ],
  "exp": 1692445741,
  "iat": 1660909741,
  "iss": "https://kubernetes.default.svc.cluster.local",
  "kubernetes.io": {
    "namespace": "default",
    "pod": {
      "name": "busybox",
      "uid": "d822ba5f-4290-4bca-94ce-f3bc0dca2e36"
    },
    "serviceaccount": {
      "name": "default",
      "uid": "8208ff56-0a67-47bb-8175-a198423dacf8"
    },
    "warnafter": 1660913348
  },
  "nbf": 1660909741,
  "sub": "system:serviceaccount:default:default"
}
```

Some of the interesting fields here (quoted descriptions from the [JWT RFC][jwt rfc]):

- `sub`: `The "sub" (subject) claim identifies the principal that is the subject of the JWT.` This is the identity that
  the API server extracts from the JWT to use when applying RBAC policies to the requests.
- `aud`: `The "aud" (audience) claim identifies the recipients that the JWT is intended for.` In this case, the token is
  intended for the API server, as we described above. The API server will reject any tokens that have an audience
  specified that does not match one of the audiences configured via the API server's `--api-audiences` flag.
- `exp`: `The "exp" (expiration time) claim identifies the expiration time on or after which the expiration time on or
  after which the JWT must not be accepted for processing.` This is a numerical date so the value above corresponds to `
  Aug 19 2023 12:49:01 UTC+0100`. The API server will reject tokens that have expired.
- `nbf`: `The "nbf" (not before) claim identifies the time before which the JWT must not be accepted for processing.` The
  value above corresponds to `Aug 19 2022 12:49:01 UTC+0100`. The API server will reject tokens that are not yet valid.
- `iat`: `The "iat" (issued at) claim identifies the time at which the JWT was issued.` The value above corresponds to
  `Aug 19 2022 12:49:01 UTC+0100`. This is the same as `nbf` claim above in this case.

## How are service account tokens generated?

Historically these were solely created by the [token controller][token controller] running in the
[Kubernetes controller manager][kube-controller-manager] (`kube-controller-manager`) process. The token controller signs
the token using the private key specified in the `--service-account-private-key-file` flag for the
`kube-controller-manager`. Tokens created in this way are stored as secrets in the API server. These tokens have no
expiration time - they are valid forever.

In Kubernetes v1.12 (many moons ago), `TokenRequestProjection` feature was enabled by default (it graduated to beta -
see [here][feature stages] for details of feature graduation). This allowed users to request an audience and time bound
token to be created and mounted into a pod at a specified path via a [projected volume][projected volume]. By adding an
expiration to the token, this increased security as any tokens that are leaked will be rejected after they expire. The
projected tokens are automatically refreshed in the pods when they near expiry by the kubelet via the `TokenRequest`
API. Clients need to re-read these tokens as they change to ensure they are using valid tokens.

In Kubernetes v1.21, `BoundServiceAccountTokenVolume` feature graduated to beta and was therefore enabled by default.
This meant that instead of the pod opting in to mounting a time-bound token, this was the default: any new pods created
would have the time-bound token mounted via a projected volume rather than the non-expiring secret-based token.

Let's take a look at a token mounted in Kubernetes v1.20, prior to the default enabling of this feature and see what's
different:

```bash
$ kind create cluster --name=sa-token-demo-v1.20 --image kindest/node:v1.20.15
$ kubectl --context kind-sa-token-demo-v1.20 run \
  --restart=Never busybox -it \
  --image=busybox --rm --quiet -- \
  cat /var/run/secrets/kubernetes.io/serviceaccount/token

eyJhbGciOiJSUzI1NiIsImtpZCI6InlTT0VvQ1NVbV9sUzhpdHlqNzJSVHZFSXNXRjN1bU9kUzBlcGtMSUs1bHMifQ.eyJpc3MiOiJrdWJlcm5ldGVzL3NlcnZpY2VhY2NvdW50Iiwia3ViZXJuZXRlcy5pby9zZXJ2aWNlYWNjb3VudC9uYW1lc3BhY2UiOiJkZWZhdWx0Iiwia3ViZXJuZXRlcy5pby9zZXJ2aWNlYWNjb3VudC9zZWNyZXQubmFtZSI6ImRlZmF1bHQtdG9rZW4tNTdsbHgiLCJrdWJlcm5ldGVzLmlvL3NlcnZpY2VhY2NvdW50L3NlcnZpY2UtYWNjb3VudC5uYW1lIjoiZGVmYXVsdCIsImt1YmVybmV0ZXMuaW8vc2VydmljZWFjY291bnQvc2VydmljZS1hY2NvdW50LnVpZCI6IjcxOTA0YzJlLTU2OWItNGEwYi05NzE2LWIzNDMwZjQzMGYyMyIsInN1YiI6InN5c3RlbTpzZXJ2aWNlYWNjb3VudDpkZWZhdWx0OmRlZmF1bHQifQ.lpKVxy28GsvcXU8TwLoC3jsdfu62CJJb65awzyB3cg0BRu5PjJHqfHawskQWbyIrVQWI7WkTaokPeourwVNIYME2zE9IdTsMuDkPV4VPzCLJcMlBjTUWbpVnfwLFhLiUz15BR1kjOdaAvTS0QCMoMJPrurW568jzmuI7_tX799EfehqfDlD-XziI1V0Wu8HHcBchagaSilOG6U2Z7njhZvBSBc145PLcDF5UBMUHrRcSPMzPFxTSf0Kpo2CjjDBEjCS_LXkuxlY4_p1s3M6Ioc0jjN4Ad2oNB0ujs9RGP8SmEOnA6wI0ZYqFWn_swq5cCgsEQl14gZLpYK5TGE6S_g
```

Again, let's decode it using [`jwt.io`][jwt.io] and see what's inside the token payload:

```json
{
  "iss": "kubernetes/serviceaccount",
  "kubernetes.io/serviceaccount/namespace": "default",
  "kubernetes.io/serviceaccount/secret.name": "default-token-57llx",
  "kubernetes.io/serviceaccount/service-account.name": "default",
  "kubernetes.io/serviceaccount/service-account.uid": "71904c2e-569b-4a0b-9716-b3430f430f23",
  "sub": "system:serviceaccount:default:default"
}
```

Notice no expiry or audience, among other missing info we noted above. Also note the
`kubernetes.io/serviceaccount/secret.name` claim, indicating this was mounted from a secret. This is unlike the token we
inspected from Kubernetes v1.24 above which, as we just discussed, comes from a projected volume instead of a secret
volume.

## What's changed in Kubernetes v1.24?

Even with time-bound tokens being mounted into pods via volume projection, every service account also had a non-expiring
token generated into a secret by the token controller. These tokens generally would not be used when running pods thanks
to the default projected volume token, so the service account token secret would rarely be used. In Kubernetes v1.24, a
small but potentially very important feature was enabled by default: `LegacyServiceAccountTokenNoAutoGeneration`.
Interestingly, this feature never went through an alpha stage, presumably because the risk of a negative impact was
deemed negligible). With this feature now enabled, non-expiring service account tokens are no longer implicitly
generated for every service account.

Let's take a look at the difference between Kubernetes v1.23 and v1.24. First in v1.24:

```bash
$ kubectl --context kind-sa-token-demo-v1.24 create serviceaccount sa-token-demo
serviceaccount/sa-token-demo created

$ kubectl --context kind-sa-token-demo-v1.24 get secrets
No resources found in default namespace.
```

And now in v1.23:

```bash
$ kind create cluster --name=sa-token-demo-v1.23 --image kindest/node:v1.23.6

$ kubectl --context kind-sa-token-demo-v1.23 create serviceaccount sa-token-demo
serviceaccount/sa-token-demo created

$ kubectl --context kind-sa-token-demo-v1.23 get secrets
NAME                        TYPE                                  DATA   AGE
default-token-hvs55         kubernetes.io/service-account-token   3      66m
sa-token-demo-token-28rqk   kubernetes.io/service-account-token   3      5s
```

We no longer have service account token secrets created by default in Kubernetes v1.24. This has an effect on scalabilty
as well as security because this reduces the number of resources in the API server (a mostly redundant secret per
service account), and reduces the load produced by the token controller running in the `kube-controller-manager`
because it doesn't need to generate these tokens.

## How does this affect you?

For most users, this change will be transparent and not require any intervention. However, service account tokens are
also completely valid to use outside of the cluster to authenticate to the API server. If you use service account tokens
in this way, you will have to make a small change to your workflow with v1.24: explicitly requesting a service account
token secret to be generated. This is completely backwards-compatible so you can apply this to any workloads running
against previous versions of Kubernetes too.

So how to do this? Create a secret like this:

```bash
$ kubectl create --context kind-sa-token-demo-v1.24 -f - <<EOF
apiVersion: v1
kind: Secret
metadata:
  name: explicit-sa-token
  annotations:
    kubernetes.io/service-account.name: sa-token-demo
type: kubernetes.io/service-account-token
EOF
secret/explicit-sa-token created
```

Note that the service account referenced by `kubernetes.io/service-account.name` annotation must exist. If you want to
be really careful, you can also specify the `kubernetes.io/service-account.uid` annotation to match the service account
you want to create a token secret for. If you don't do this, then the token controller will fill this for you when it
populates the token secret.

And let's look at the secret:

```bash
$ kubectl get secret --context kind-sa-token-demo-v1.24 explicit-sa-token -oyaml

apiVersion: v1
data:
  ca.crt: LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0tCk1JSUMvakNDQWVhZ0F3SUJBZ0lCQURBTkJna3Foa2lHOXcwQkFRc0ZBREFWTVJNd0VRWURWUVFERXdwcmRXSmwKY201bGRHVnpNQjRYRFRJeU1EZ3hPVEV4TkRReU9Gb1hEVE15TURneE5qRXhORFF5T0Zvd0ZURVRNQkVHQTFVRQpBeE1LYTNWaVpYSnVaWFJsY3pDQ0FTSXdEUVlKS29aSWh2Y05BUUVCQlFBRGdnRVBBRENDQVFvQ2dnRUJBT0N5CjRNbkw5emhUMHV4Y2ZKRU9oTVFocEF2SEJnWU5iNHVyY1llL0VNb0Z1dGllSS9zeXVjOFRmSTk4ZnVaNzYzYkUKYkg0WGRwT1NvcmdGZnczRGVFdjcyOGR5YTY1eUpwSXp5OWZ6ZGc3OEhkQ2NMcjZxNmhhek94eUxFWVhJUlBCTApGUDk4cU9Ib29MQVhjd0VjeFRaQXVyUzkwcFhVQ2Y3L2xYL0ZUK3poVEF4RFZQRU9TVitENnZSRVlveitQLzk2ClI3NlZta2IxQnFNSnJaOGhhSm84RVJXeXltdTBxemYyNzViUmttdjBjcjYzNjgzQWVpNmtjS2JtWENhOENqd2oKeU5sSWozQUZjQzlTUWVxeUFyWkdGeXJRVmlZcWoyVzJwRGxzejZaemtwSVR0VDdobzhveDZKRDZxcTQ0UFZEaQp2dEo3aDRNWFJVUlJXMTgzWUFFQ0F3RUFBYU5aTUZjd0RnWURWUjBQQVFIL0JBUURBZ0trTUE4R0ExVWRFd0VCCi93UUZNQU1CQWY4d0hRWURWUjBPQkJZRUZMdlo0TnEzVlpRbXlLRFNzOUZTSWJId3M3Wk1NQlVHQTFVZEVRUU8KTUF5Q0NtdDFZbVZ5Ym1WMFpYTXdEUVlKS29aSWh2Y05BUUVMQlFBRGdnRUJBTmRsMWxxcSt1VGVwUXUrOWVIOApVckJpM3N3cThGV3RGenNMYzlnU3JVblVxNmpxWWR4Y01ITXUwZlllUmJNVGZEVjVNRkFaVkZPYlZzbUwvdERICk9qR29hUW9hcWI1b2tFSExQeUVXQjVEZ012MXNXUlRzS29vRDZZY1Y4MW5kc3lnUlA5RmhVU0FGTVRNV1dPRWIKbW9GQzFPMEczcGdLME93ZDU0RitsN2l4eE14V2l1cWhmVEw1VU42NVNVeWV6UG5HQnhkWHZ4d096MWNUR1JmWApKRGhoN0NkUjFsS1RwOXhJQkFmTE5zdElwbHFtZzRvOWZnS3duSzRaeS9zQURCU0FFcjFzZ3JFcUsrTXN1NkJqCnh6aUV3aEdHeFlxQ2NRdGZFb2ZQbUxpcFB3Z1RpazBnam9RUUc3WDRxS1UyRmZlMk5hM2dIMHN6VVdTa0I5K3kKSDJRPQotLS0tLUVORCBDRVJUSUZJQ0FURS0tLS0tCg==
  namespace: ZGVmYXVsdA==
  token: ZXlKaGJHY2lPaUpTVXpJMU5pSXNJbXRwWkNJNkluZE5WVFJIVDNOMWNWQnVSbXBRWVhJM1RtRmFXbFJGYlU1c1l6SkpYMWMzTldaaFJVUmlURUkzWkVraWZRLmV5SnBjM01pT2lKcmRXSmxjbTVsZEdWekwzTmxjblpwWTJWaFkyTnZkVzUwSWl3aWEzVmlaWEp1WlhSbGN5NXBieTl6WlhKMmFXTmxZV05qYjNWdWRDOXVZVzFsYzNCaFkyVWlPaUprWldaaGRXeDBJaXdpYTNWaVpYSnVaWFJsY3k1cGJ5OXpaWEoyYVdObFlXTmpiM1Z1ZEM5elpXTnlaWFF1Ym1GdFpTSTZJbVY0Y0d4cFkybDBMWE5oTFhSdmEyVnVJaXdpYTNWaVpYSnVaWFJsY3k1cGJ5OXpaWEoyYVdObFlXTmpiM1Z1ZEM5elpYSjJhV05sTFdGalkyOTFiblF1Ym1GdFpTSTZJbk5oTFhSdmEyVnVMV1JsYlc4aUxDSnJkV0psY201bGRHVnpMbWx2TDNObGNuWnBZMlZoWTJOdmRXNTBMM05sY25acFkyVXRZV05qYjNWdWRDNTFhV1FpT2lKaU5qSmlZek15WlMxaU5UQXlMVFEyTlRRdE9USXhaQzA1TkdFM05ESmxNamN6WVRnaUxDSnpkV0lpT2lKemVYTjBaVzA2YzJWeWRtbGpaV0ZqWTI5MWJuUTZaR1ZtWVhWc2REcHpZUzEwYjJ0bGJpMWtaVzF2SW4wLkdZeTdEWEd4Tk1OdkpsT0hHN0pKMVFyOXhtcnR1NG5zbURmMFZsM0JGd2ZrcW1BT3Q0d0VJUGI5aXd3ZzdYSnVRejBob0pZem5kWnBTUUdwSHU4alZ1ZG5ITVFVNjl5LVpGZFVON3REc1AyNVdjSWhDelFvQmZpcmRhUWtYanU2MS1jVFdpUEV2blNXRE9IeXEyOWhZdVk2WUlISU0xbkZ0SlA5V0V6SHktbmFzV2tLUDJhMXFsTl96WWZHRGVWSU9oeTFVRFE5N2F3TnVSNGcyalA1WE1teTIxV2pHTE8tXy1GdFdoYUFzYmpISDVpVnk3RzNGbWxEOVB3a0ptYk1OTDdDS1dqMDB2SnpvSVREa1ZCVGhNWHh1MllrN3hEM2tzcEJMWTZ2ZHpqWWNGWkh6b25Ga2ZzZ2FjV2dDcEhvMnRjYjRmb0RDVndmX3QtbVl3M1Y1dw==
kind: Secret
metadata:
  annotations:
    kubernetes.io/service-account.name: sa-token-demo
    kubernetes.io/service-account.uid: b62bc32e-b502-4654-921d-94a742e273a8
  creationTimestamp: "2022-08-19T13:36:42Z"
  name: explicit-sa-token
  namespace: default
  resourceVersion: "8554"
  uid: 72c2a4f0-636d-4a70-9f1c-55a75f15e520
type: kubernetes.io/service-account-token
```

If we look at the actual generated token (remember that secret data is stored base64 encoded):

```bash
$ kubectl get secret --context kind-sa-token-demo-v1.24 explicit-sa-token -ojsonpath='{.data.token}' | base64 -d
eyJhbGciOiJSUzI1NiIsImtpZCI6IndNVTRHT3N1cVBuRmpQYXI3TmFaWlRFbU5sYzJJX1c3NWZhRURiTEI3ZEkifQ.eyJpc3MiOiJrdWJlcm5ldGVzL3NlcnZpY2VhY2NvdW50Iiwia3ViZXJuZXRlcy5pby9zZXJ2aWNlYWNjb3VudC9uYW1lc3BhY2UiOiJkZWZhdWx0Iiwia3ViZXJuZXRlcy5pby9zZXJ2aWNlYWNjb3VudC9zZWNyZXQubmFtZSI6ImV4cGxpY2l0LXNhLXRva2VuIiwia3ViZXJuZXRlcy5pby9zZXJ2aWNlYWNjb3VudC9zZXJ2aWNlLWFjY291bnQubmFtZSI6InNhLXRva2VuLWRlbW8iLCJrdWJlcm5ldGVzLmlvL3NlcnZpY2VhY2NvdW50L3NlcnZpY2UtYWNjb3VudC51aWQiOiJiNjJiYzMyZS1iNTAyLTQ2NTQtOTIxZC05NGE3NDJlMjczYTgiLCJzdWIiOiJzeXN0ZW06c2VydmljZWFjY291bnQ6ZGVmYXVsdDpzYS10b2tlbi1kZW1vIn0.GYy7DXGxNMNvJlOHG7JJ1Qr9xmrtu4nsmDf0Vl3BFwfkqmAOt4wEIPb9iwwg7XJuQz0hoJYzndZpSQGpHu8jVudnHMQU69y-ZFdUN7tDsP25WcIhCzQoBfirdaQkXju61-cTWiPEvnSWDOHyq29hYuY6YIHIM1nFtJP9WEzHy-nasWkKP2a1qlN_zYfGDeVIOhy1UDQ97awNuR4g2jP5XMmy21WjGLO-_-FtWhaAsbjHH5iVy7G3FmlD9PwkJmbMNL7CKWj00vJzoITDkVBThMXxu2Yk7xD3kspBLY6vdzjYcFZHzonFkfsgacWgCpHo2tcb4foDCVwf_t-mYw3V5w
```

And once more inspect it on [`jwt.io`][jwt.io] we can see that the token is non-expiring:

```json
{
  "iss": "kubernetes/serviceaccount",
  "kubernetes.io/serviceaccount/namespace": "default",
  "kubernetes.io/serviceaccount/secret.name": "explicit-sa-token",
  "kubernetes.io/serviceaccount/service-account.name": "sa-token-demo",
  "kubernetes.io/serviceaccount/service-account.uid": "b62bc32e-b502-4654-921d-94a742e273a8",
  "sub": "system:serviceaccount:default:sa-token-demo"
}
```

I hope you've enjoyed this deep dive into service account tokens.

[disable sa token]: https://kubernetes.io/docs/tasks/configure-pod-container/configure-service-account/#use-the-default-service-account-to-access-the-api-server
[disable pod sa token]: https://github.com/kubernetes/api/blob/master/core/v1/types.go#L3147-L3149
[jwt rfc]: https://www.rfc-editor.org/rfc/rfc7519
[token controller]: https://kubernetes.io/docs/reference/access-authn-authz/service-accounts-admin/#token-controller
[kube-controller-manager]: https://kubernetes.io/docs/reference/command-line-tools-reference/kube-controller-manager/
[bearer token]: https://kubernetes.io/docs/reference/access-authn-authz/authentication/#putting-a-bearer-token-in-a-request
[rbac]: https://kubernetes.io/docs/reference/access-authn-authz/rbac/#api-overview
[kind]: https://kind.sigs.k8s.io/
[jwt.io]: https://jwt.io/
[feature stages]: https://kubernetes.io/docs/reference/command-line-tools-reference/feature-gates/#feature-stages
[projected volume]: https://kubernetes.io/docs/concepts/storage/projected-volumes/#serviceaccounttoken
