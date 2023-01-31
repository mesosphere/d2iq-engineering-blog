---
authors: ["dkoshkin"]
title: "Hybrid Cloud With DKP"
date: 2023-01-17T09:19:06-08:00
featured: false
tags: ["cluster api", "capi", "kubernetes", "dkp", "hybrid-cloud", "aws"]
excerpt: "Learn how to deploy a Kubernetes cluster in GCP with an additional preprovisioned nodepool"
feature_image: feature.png
---

In this context we will define Hybrid Cloud as a deployment of a single Kubernetes cluster across a public cloud and preprovisioned infrastructure. More specifically, we will run the control-plane and a set of worker Nodes in AWS using [CAPA](hhttps://github.com/kubernetes-sigs/cluster-api-provider-aws) and a separate pre-provisioned set of Nodes, for simplicity it will also be deployed in AWS, but the Nodes can run on-prem or any other cloud with an open UDP port.

Creating this type of cluster is relatively simple, the challenge however is setting up cross network communication for Pod and Kubernetes Service networking and supporting `kubectl logs` and `kubectl exec` features. Luckily we can achieve both using [Kilo](https://github.com/squat/kilo). Kilo is a multi-cloud network overlay built on WireGuard and designed for Kubernetes.

## Create a bootstrap cluster

Create a bootstrap cluster:

```bash
export AWS_REGION=us-west-2
export AWS_PROFILE=<profile>
dkp create bootstrap --with-aws-bootstrap-credentials=true
```

## Create an AWS cluster

We will need to make a few changes to the standard cluster spec for the AWS cluster.

1. Generate a `cluster.yaml` file with DKP using `--dry-run -o yaml` flags:

```bash
export CLUSTER_NAME=dkp-hybrid-cloud-demo
dkp create cluster aws --cluster-name $CLUSTER_NAME --control-plane-replicas=1 --worker-replicas=1 --dry-run -o yaml > cluster.yaml
```

2. Add SecurityGroup Inbound rules for  Wireguard port `51820`, by adding below values to `AWSCluster.spec.network.cni.cniIngressRules`:

```yaml
      - description: "wireguard tcp"
        protocol: tcp
        fromPort: 51820
        toPort: 51820
      - description: "wireguard udp"
        protocol: udp
        fromPort: 51820
        toPort: 51820
```

3. Enable public IPs for on AWS instances by adding below value to `AWSMachineTemplate.spec.template.spec.publicIP` for both control-plane and worker templates:

```yaml
      publicIP: true
```

4. Create the cluster resources:

```bash
kubectl create -f cluster.yaml
```

5.  Unfortunately at this time [Kilo](https://github.com/squat/kilo) does not support the [Calico CNI](https://projectcalico.docs.tigera.io/about/about-calico). For this blog post we will disable Calico and deploy Kilo's CNI following the [official instructions](https://kilo.squat.ai/docs/introduction#step-5-install-kilo) in a later step. 

```bash
kubectl delete clusterresourceset calico-cni-installation-$CLUSTER_NAME
```

## Create a pre-provisioned nodepool

1. Create a Secret with the SSH details:

```bash
export SSH_PRIVATE_KEY_FILE=<file>
kubectl create secret generic preprovisioned-ssh --from-file=ssh-privatekey="$SSH_PRIVATE_KEY_FILE"
```

2. Create the nodepool:

```bash
export NODEPOOL_NAME=$CLUSTER_NAME-preprovisioned-np
# must be a public IP or reachable from the GCP network 
export WORKER_ADDRESS=<>
export KUBE_APISERVER_ADDRESS=https://$(kubectl get awscluster $CLUSTER_NAME -o=jsonpath='{.spec.controlPlaneEndpoint.host}')
```

```bash
cat <<EOF | kubectl create -f -
apiVersion: infrastructure.cluster.konvoy.d2iq.io/v1alpha1
kind: PreprovisionedCluster
metadata:
  name: $CLUSTER_NAME
spec:
  controlPlaneEndpoint:
    host: $KUBE_APISERVER_ADDRESS
    port: 6443
  ---
apiVersion: cluster.x-k8s.io/v1beta1
kind: MachineDeployment
metadata:
  name: $NODEPOOL_NAME
spec:
  clusterName: $CLUSTER_NAME
  replicas: 1
  selector:
    matchLabels: null
  template:
    spec:
      bootstrap:
        configRef:
          apiVersion: bootstrap.cluster.x-k8s.io/v1beta1
          kind: KubeadmConfigTemplate
          name: $NODEPOOL_NAME
      clusterName: $CLUSTER_NAME
      infrastructureRef:
        apiVersion: infrastructure.cluster.konvoy.d2iq.io/v1alpha1
        kind: PreprovisionedMachineTemplate
        name: $NODEPOOL_NAME
      version: 1.24.6
  ---
apiVersion: infrastructure.cluster.konvoy.d2iq.io/v1alpha1
kind: PreprovisionedMachineTemplate
metadata:
  name: $NODEPOOL_NAME
spec:
  template:
    spec:
      inventoryRef:
        name: $NODEPOOL_NAME-inventory
        namespace: default
  ---
apiVersion: bootstrap.cluster.x-k8s.io/v1beta1
kind: KubeadmConfigTemplate
metadata:
  name: $NODEPOOL_NAME
spec:
  template:
    spec:
      joinConfiguration:
        nodeRegistration:
          kubeletExtraArgs:
            cloud-provider: ''
            provider-id: "{{ .ProviderID }}"
  ---
apiVersion: infrastructure.cluster.konvoy.d2iq.io/v1alpha1
kind: PreprovisionedInventory
metadata:
  name: $NODEPOOL_NAME-inventory
spec:
  hosts:
    - address: $WORKER_ADDRESS
  sshConfig:
    port: 22
    user: ubuntu
    privateKeyRef:
      name: preprovisioned-ssh
      namespace: default
  EOF
```

## Install Kilo

1. Get the admin kubeconfig:

```bash
dkp get kubeconfig -c $CLUSTER_NAME  > $CLUSTER_NAME.conf
export KUBECONFIG=$CLUSTER_NAME.conf
```

2. [Kilo requires at least one Node in each location to have a public IP](https://kilo.squat.ai/docs/introduction#step-4-ensure-nodes-have-public-ip). The Nodes we have provisioned all have a public IP, however we need to annotate the `Nodes` objects to have Kilo discover these IPs.

  For example, here is the list of Nodes in my cluster, where `ip-10-0-11-8.us-west-2.compute.internal` is the AWS machine and its public IP is `18.236.154.196`, and `ip-10-0-181-191` is the pre-provisioned machine:

```bash
$ kubectl get nodes
NAME                                        STATUS     ROLES           AGE   VERSION
ip-10-0-22-184.us-west-2.compute.internal   NotReady   control-plane   26m   v1.24.6
ip-10-0-11-8.us-west-2.compute.internal     NotReady   <none>          26m   v1.24.6
ip-10-0-181-191                             NotReady   <none>          6s    v1.24.6
```

```bash
kubectl annotate node <ip-10-0-11-8.us-west-2.compute.internal> kilo.squat.ai/force-endpoint=<18.236.154.196>:51820
kubectl annotate node <ip-10-0-181-191> kilo.squat.ai/force-endpoint=$WORKER_ADDRESS:51820
```

3. Install [Kilo](https://kilo.squat.ai/docs/introduction#step-5-install-kilo):

```bash
kubectl apply -f https://raw.githubusercontent.com/squat/kilo/main/manifests/crds.yaml
kubectl apply -f https://raw.githubusercontent.com/squat/kilo/main/manifests/kilo-kubeadm.yaml
```

## Verify Networking

1. Confirm the Nodes are `Ready`:

```bash
$ kubectl get nodes
NAME                                        STATUS   ROLES           AGE   VERSION
ip-10-0-11-8.us-west-2.compute.internal     Ready    <none>          46m   v1.24.6
ip-10-0-181-191                             Ready    <none>          20m   v1.24.6
ip-10-0-22-184.us-west-2.compute.internal   Ready    control-plane   47m   v1.24.6
```
    
2. Confirm `kubectl logs` command works for pods on all Nodes. In this example we'll use the `kube-proxy` DaemonSet and you should see the logs from three pods:

```bash
$ kubectl logs --selector k8s-app=kube-proxy --namespace kube-system
... "Starting service config controller"
... "Starting service config controller"
... "Starting service config controller"
```

3. Explore the cluster by deploying your own workloads.

## Delete the Cluster

1. Unset `KUBECONFIG` to use the bootstrap cluster again:

```bash
unset KUBECONFIG
```

2. Delete the preprovisioned `MachineDeployment`:

```bash
kubectl delete machinedeployment $NODEPOOL_NAME
```

3. Delete cluster:

```bash
dkp delete cluster -c $CLUSTER_NAME
```

Well thats it. This was a quick example of using DKP with an AWS cluster and an additional Node ina different network, using [Kilo](https://github.com/squat/kilo) as the cluster CNI.