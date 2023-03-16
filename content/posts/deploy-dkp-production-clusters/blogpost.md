---
author: julferts@d2iq.com
title: Deploying Production clusters at D2iQ
date: 2022-06-01
draft: true
---

Deploying clusters with DKP is easy, but in common production environments the cluster must fit into the existing ecosystem respecting permissions and user roles, dealing with Docker registry authentication or using a special certificate issuer.

# What means production cluster
With this post we want to explain how a DKP cluster can be created in a repoducable way that is using SSO instead of static credentials, ensuring to not run into rate limiting for docker hub pulls or ACME based certificate requests.


# DKP on AWS
We consider AWS is being used in this example. Although most things will definitely work on other clouds or on-prem but in detail permissions and configs might be slightly different. You would also need IAM permissions to do the exact same thing in our account.

## Shared bootstrap cluster
In many case using the `dkp` cli with its build-in bootstrap cluster is the easiest way to deploy DKP 2.x clusters but when it comes to the ability to reproduce things or not depending on an operators machine when it comes to huge initial clusters we will use EKS [^1]. This reduces the dependency on the operators machine to an extremely low level.

## Konvoy Image Builder
We expect a custom image ID is known and being provided as an ami-id to the followin commands. Whenever `<AMI>` is mentioned we consider a KIB image to be provided.
Please consult the [Image Builder Docs](https://docs.d2iq.com/dkp/konvoy/2.2/image-builder/) for more details.

## Terraform
We'll use Terraform[^2] to maintain the IAM Policy, Role and Instance Profiles. Alternatives could be simple AWS-CLI usage or Cloudformation templates but for us the easiest way maintaining clusters with multiple operators is using Terraform as it gives us out of the box shared state and locking mechanisms[^3]

## Authentication
D2iQ uses Onelogin as its SSO provider but any OIDC Identity provider[^4] will work. In many cases using Google as Identity provider is the simplest solution [^5]


# Getting things started
Before we spawn the cluster some foundation needs to be done. Like described above we'll be using terraform for that.


## AWS IAM policy, role and instance profiles


[^1]: Amazon Elastic Kubernetes Service is a managed Kubernetes cluster by AWS https://aws.amazon.com/eks/
[^2]: https://terraform.io
[^3]: https://www.terraform.io/language/settings/backends/s3
[^4]: https://en.wikipedia.org/wiki/List_of_OAuth_providers
[^5]: https://developers.google.com/identity/protocols/oauth2/openid-connect
