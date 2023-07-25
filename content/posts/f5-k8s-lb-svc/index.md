---
authors: ["arbhoj"]
title: "Auto Provisioning Kubernetes LoadBalancer Services with F5"
date: 2023-03-29T22:00:00+02:00
tags: ["load-balancer", "f5"]
excerpt: Learn how to configure a Kubernetes cluster to provision a service of type LoadBalancer with F5 BIG-IP
feature_image: feature.jpg
---

When deploying Kubernetes clusters in the cloud (AWS, Azure, GCP etc.) a Kubernetes service of type [LoadBalancer](https://kubernetes.io/docs/concepts/services-networking/service/#loadbalancer) is by default provisioned automatically by the appropriate [cloud controller manager](https://kubernetes.io/docs/concepts/architecture/cloud-controller/) using the native load-balancer service (e.g. [ELB](https://aws.amazon.com/elasticloadbalancing/) on AWS). It's not the same for on-premise clusters, which require additional components to be deployed/configured to get this functionality. There are a few Kubernetes native options like [metallb](https://metallb.universe.tf/) and [kube-vip](https://kube-vip.io/). However, for production clusters and clusters that process heavy traffic, an external load-balancer might be a better choice. [F5 BIG-IP LTM](https://www.f5.com/products/big-ip-services/local-traffic-manager) is one of the most widely used load-balancers in the industry today and the best thing is that it integrates really nicely with Kubernetes.

In this blog we will see how to configure an on-premise Kubernetes cluster to integrate with [F5 BIG-IP LTM](https://www.f5.com/products/big-ip-services/local-traffic-manager) to provision a service of type `LoadBalancer`.

# Integrating a Kubernetes cluster with F5

## Requirements
1. Pre-configured [F5 BIG](https://www.f5.com/products/big-ip-services/local-traffic-manager) cluster
2. F5 [Partition](https://techdocs.f5.com/kb/en-us/products/big-ip_ltm/manuals/product/bigip-user-account-administration-12-0-0/3.html) that will be managed by this automation along with credentials for a service account that has admin permissions for the given partition
3. [AS3](https://clouddocs.f5.com/products/extensions/f5-appsvcs-extension/latest/) 3.39 or newer installed on the F5 cluster
4. IP's availble to be used as VIPs for [Virtual Server](https://techdocs.f5.com/kb/en-us/products/big-ip_ltm/manuals/product/ltm-basics-11-6-0/2.html) instances
5. Working Kubernetes cluster with [PV](https://kubernetes.io/docs/concepts/storage/persistent-volumes/) Storage configured
6. If using the CAPI steps then a CAPI bootstrap/management cluster and configurations to deploy a cluster. Refer [DKP](https://docs.d2iq.com/dkp/latest/infrastructure-quick-start-guides) documentation for more details.
7. This uses `docker.io/f5networks/f5-ipam-controller:0.1.5` for [FIC](https://github.com/F5Networks/f5-ipam-controller) & `docker.io/f5networks/k8s-bigip-ctlr:2.9.1` for [CIS](https://github.com/F5Networks/k8s-bigip-ctlr) capabilities. Download, retag and push the images to a local registry and change the deployment spec to point to a local image registry for airgapped environments.

This blog used the following versions to test:

* BIG-IP: 16.1.3.1 Build 0.0.11 Point Release 1
* AS3: v3.39.0
* BIG-IP-CTLR: 2.9.1

## Steps to Integrate a Kubernetes Cluster With F5 BIG-IP
There are two options based on whether F5 controllers are to be directly deployed to the target cluster, or deployed via [`ClusterResourceSets`](https://cluster-api.sigs.k8s.io/tasks/experimental-features/cluster-resource-set.html) for a [CAPI](https://cluster-api.sigs.k8s.io/) provisioned cluster either at cluster creation time or after the cluster has been deployed.


### Option 1: Directly deploy F5 Controllers to a Kubernetes Cluster

#### Step 1: Deploy F5 Big IP Container Ingress Services (CIS)


##### - Add helm repo
```
helm repo add f5-stable https://f5networks.github.io/charts/stable
```

##### - Create values yaml

```
export BIG_IP_URL=https://big-ip-host
export BIG_IP_PARTITION=big-ip-partition
export CLUSTER_NAME=dkp-demo

cat <<EOF > f5-${CLUSTER_NAME}-values.yaml
bigip_login_secret: f5-bigip-ctlr-login
rbac:
  create: true
serviceAccount:
  create: true
namespace: kube-system
args:
  bigip_url: ${BIG_IP_URL}
  bigip_partition: ${BIG_IP_PARTITION}
  log_level: info
  pool_member_type: nodeport
  insecure: true
  custom-resource-mode: true
  log-as3-response: true
  ipam : true
image:
  # Use the tag to target a specific version of the Controller
  user: f5networks
  repo: k8s-bigip-ctlr
  pullPolicy: Always
resources: {}
version: 2.9.1
EOF
```

##### - Install

```
export F5_USER=f5-user
export F5_PASSWD=f5-password
export KUBECONFIG=kubeconfig-file-path

kubectl create secret generic f5-bigip-ctlr-login -n kube-system --from-literal=username=${F5_USER} --from-literal=password=${F5_PASSWD}

helm install -f f5-${CLUSTER_NAME}-values.yaml f5ctlr f5-stable/f5-bigip-ctlr --version 0.0.21
```

### Step 2: Deploy F5 IPAM Controller (FIC)

##### - Add helm repo
```
helm repo add f5-ipam-stable https://f5networks.github.io/f5-ipam-controller/helm-charts/stable
```

##### - Create values yaml

```
export RANGE='{"ingress":"144.217.53.168-144.217.53.169"}'
cat <<EOF > f5-ipam-${CLUSTER_NAME}-values.yaml
rbac:
  create: true
serviceAccount:
  create: true
namespace: kube-system
args:
  orchestration: "kubernetes"
  provider: "f5-ip-provider"
  ip_range: '$RANGE'
image:
  # Use the tag to target a specific version of the Controller
  user: f5networks
  repo: f5-ipam-controller
  pullPolicy: Always
  version: 0.1.5
volume:
  mountPath: /app/ipamdb
  mountName: fic-volume-mount
  pvc: fic-volume-claim
EOF
```
>The RANGE variable contains key/value pairs for labels and the IP ranges to be served by the IPAM controller. The range used here should be a valid reserved IP range.

##### - Install

```
export KUBECONFIG=kubeconfig-file-path

# Create PVC
kubectl apply -f - <<EOF
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: fic-volume-claim
  namespace: kube-system
spec:
  accessModes:
  - ReadWriteOnce
  resources:
    requests:
      storage: 0.1Gi
EOF

helm install -f f5-ipam-${CLUSTER_NAME}-values.yaml f5-ipam  f5-ipam-stable/f5-ipam-controller --version 0.0.1
```

### Option 2: Deploy Automatically via CAPI
>Note: If deploying to a CAPI provisioned Kubernetes Cluster like [DKP](https://docs.d2iq.com/dkp/latest/infrastructure-quick-start-guides) instead of running the install command manually, the above can be packaged into a CAPI ClusterResourceSet by doing the following and incorporated into the cluster deployment process.


#### Pre-step
Create a directory with the name of the cluster and move to that directory so that all the artifacts are generated there

```
export CLUSTER_NAME=cluster-name
mkdir $CLUSTER_NAME && cd $CLUSTER_NAME
```

If not already done generate CAPI cluster manifest.
>Hint: Use [DKP](https://docs.d2iq.com/dkp/latest/infrastructure-quick-start-guides) to easily generate one

#### Step 1: Deploy F5 Big IP Container Ingress Services (CIS)


>Note: Ensure that KUBECONFIG is pointing to the bootstrap/management cluster that is managing the lifecycle of the target cluster to which the F5 controllers are being deployed

```
export CLUSTER_NAME=cluster-name
export BIG_IP_URL=https://big-ip-host
export BIG_IP_PARTITION=big-ip-partition
export F5_USER=f5-user
export F5_PASSWD=f5-password

# Run script to generate ClusterResourceSet manifest to deploy F5 CIS
. ./capi-package-f5-controller.sh

```
>The above will generate `f5-cluster-resoureset-${CLUSTER_NAME}.yaml`

### Step 2: Deploy F5 IPAM Controller (FIC)
```
export CLUSTER_NAME=cluster-name
export RANGE='{"ingress":"144.217.53.168-144.217.53.169"}'

# Run script to generate ClusterResourceSet manifest to deploy F5 FIC
. ./capi-package-f5-ipam-controller.sh
```

>The above will generate `f5-ipam-cluster-resoureset-${CLUSTER_NAME}.yaml`

Now deploy the `f5-cluster-resoureset-${CLUSTER_NAME}.yaml` and ``f5-ipam-cluster-resoureset-${CLUSTER_NAME}`.yaml` manifest created above to the CAPI bootstrap/management cluster using `kubectl create -f` command along with the new cluster specs (i.e. the specs created using the `dkp create cluster` command).

e.g.
```
kubectl create -f .
```
This will deploy the cluster along with the F5 controllers fully configured

<br/>
<br/>

## Test

Once the cluster is deployed successfully test by deploying an nginx service

Set KUBECONFIG to point to the target managed cluster where the F5 controllers where deployed.
> If using [DKP](https://docs.d2iq.com/dkp/latest/dkp-get-kubeconfig) the kubeconfig of the cluster can be retrieved by using the following command

```
dkp get kubeconfig -c ${CLUSTER_NAME} > ${CLUSTER_NAME}.conf

#Set KUBECONFIG
export KUBECONFIG=$(pwd)/${CLUSTER_NAME}.conf
```

Now deploy the test service

```
kubectl create deploy nginx --image nginx:alpine
kubectl create service loadbalancer nginx --tcp=80:80 --dry-run=client -o json | kubectl patch -f - --local -p '{"metadata": {"annotations": {"cis.f5.com/ipamLabel": "ingress", "cis.f5.com/health": "{\"interval\": 10, \"timeout\": 31}"}}}' --dry-run=client -o yaml | kubectl apply -f -
```

- Verify

```
kubectl get svc nginx

```

Sample Output

```
k get svc
NAME         TYPE           CLUSTER-IP      EXTERNAL-IP      PORT(S)        AGE
kubernetes   ClusterIP      10.96.0.1       <none>           443/TCP        6d21h
nginx        LoadBalancer   10.104.32.108   144.217.53.169   80:31444/TCP   34s
```

Optionally login to F5 portal and verify

Test Service via Loadbalancer VIP (i.e. using the value of the `EXTERNAL-IP` field)
```
curl http://144.217.53.169 #This should respond with the nginx default page
```

So, we now have an on-premise Kubernets cluster tightly integrated with F5 BIG-IP that will react to the lifecycle of services of type LoadBalancer created in the cluster (optionally configured to only do this for certain namespaces).

In this blog we saw the options to provision a Kubernetes services of type LoadBalancer in an on-premise cluster and how easy it is to configure a cluster to do this using F5 BIG-IP.
