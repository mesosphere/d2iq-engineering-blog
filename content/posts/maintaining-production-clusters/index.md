---
authors: ["julferts"]
title: "Maintaining DKP Production Clusters"
slug: maintaining-production-clusters
date: 2022-09-07T15:49:54+01:00
featured: true
tags: ["Multicluster", "Scale", "Big Clusters"]
excerpt: Tweaks and customisations to run and maintain production grade clusters with DKP.
description: Tweaks and customisations to run and maintain production grade clusters with DKP.
feature_image: multiple-clouds.jpg
---

# Intro
Deploying clusters with DKP is pretty easy and the average single cluster of a small size ( about 5-15 nodes ) will work out of the box without anything to change.
However when it comes to production grade clusters in enterprise environments certain needs need to be fulfilled and probably multiple clusters or clusters with a size beyond 20 nodes are needed. While the base K8s functionality will still work with DKP defaults certain scalability issues could show up.

D2iQ is constantly doing scale-tests to find pitfalls and tweaking possibilities when running medium to big sized clusters.

## Well known scaleability issues
We already have a good idea about the issues which could show up when it comes to scaling DKP clusters. Not every of these issues is directly related to the size of the cluster but more to the workloads and services being used on it but with larger sized clusters the certainty to hit these limits is definitely raising.

### Using KIB images rather than default CAPI images
While the base functionality of DKP is definitely given when using the default images ( community driven CAPI images ) D2iQ customised images build by [KIB](https://docs.d2iq.com/dkp/2.3/create-a-custom-ami) should be the only choice when production grade clusters are deployed. With these images certain performance tweaks are applied. Also all D2iQ testing is only done against KIB build images.


### Dockerhub rate limiting
Nowadays many Helmcharts and applications are using containers from common or well-known registries like Dockerhub. Since Dockerhub [introduced pull-rate limiting based on the source IP address](https://docs.docker.com/docker-hub/download-rate-limit/#what-is-the-download-rate-limit-on-docker-hub) there is a huge chance to hit this rate-limit when bootstrapping a cluster and applications or having deployments constantly pulling/failing containers from Dockerhub.

So one solution could be using private registries like [EKS](https://aws.amazon.com/eks/) on AWS but this is not always a possible solution as maybe upstream Helmcharts are being using and images should/cannot be changed.
Another solution is using authenticated pulls from Dockerhub where the rate limit is now based on the subscription being used but even doubled with a free account.

For either of those options containerd config has to be applied to every node in the cluster.

### External DNS
This is not directly a known scaling issue but when it comes to production grade clusters service deployment is drastically easier and improved when the cluster is able to maintain DNS entries by itself.

### SSL ACME rate limiting
By default DKP will configure Letsencrypt to be used as the default ACME provider allowing automatic rotation of certificates. When a given amount of certificates and services are being used Letsenrypt will also [rate limit certificate requests](https://letsencrypt.org/docs/rate-limits/)

Sadly Letsencrypt does not offer any subscription to mitigate this issue. However there are other providers we could use instead. Two of these options are [ssl.com](https://www.ssl.com/how-to/order-free-90-day-ssl-tls-certificates-with-acme/) and [zerossl](https://zerossl.com/features/acme/).

DKP Kommander allows users to change the ACME settings for the default `ClusterIssuer` being used.

### Internal Networking / Calico Routereflectors
Growing clusters with a lot of applications and internal addresses which needs to be managed will make it harder and harder for Calico to maintain iBGP tables. A more efficient ways for each calico node to handle the rising size of routes is using a dedicated pool auf route-reflectors which are being used to keep the routing table and let other calico nodes use these as their source of route-path.

### Prometheus
The more applications and pods a cluster is running the more metrics need to be stored and maintained this means prometheus must get more resources than on a small sized cluster. It is not easy to give specific sizing for prometheus as its heavily depending on the cluster size, amount of pods and amount of metrics being send. But once we reach the above mentioned sizing limits it is definitely important to separate monitoring from usual workloads. This could be done by using an exclusive node-pool for prometheus and applying taints and labels to this pool as well as letting prometheus tolerate those and use node-selectors

### Logging / Grafana Loki
TBD

### SSO usage / Dex
Using SSO or any sort of authentication with DKP is nothing which is exclusively for large scaled clusters its importance is rising with the amount of users and also attached clusters of a DKP production deployment.

So whenever a large cluster or multiple clusters are being deployed we could expect different user groups are using the cluster. Which means the SSO and multi-cluster management functionality can be used to maintain access to different clusters, workspaces and namespaces.

# Hands on
While most of the above topics could be solved with the [D2iQ DKP Documentation](https://docs.d2iq.com/dkp/2.3) we'd still like to give some simple examples how to mitigate the above mentioned issues.

## Configure SSO using Onelogin and groups
...

## Apply containerd config for image registries
...

## Configure external DNS using Route53

...

## Use ssl.com as the default ClusterIssuer
...

## Add a routereflector nodepool and configure calico
...

## Let Prometheus, Grafana and Alertmanager use a dedicated nodepool
...
