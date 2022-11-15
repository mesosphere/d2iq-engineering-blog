---
authors: ["Arvind Bhoj"]
title: "CAPI vSphere (capv) - Nodes With predefined IP Ranges"
date: 2022-10-26T15:46:46-04:00
featured: false
tags: ["cluster api", "vsphere", "capv", "ip address"]
excerpt: Learn how to predefine a range of IP Addresses for nodes provisioned via clusterapi capv provisioner
feature_image: mail.png
---

# Why is a predefined IP Address range required for nodes when building a Kubernetes cluster?

When deploying Kubernetes on [vSphere](https://en.wikipedia.org/wiki/VMware_vSphere) or another on-prem environment, it is often desirable to use an external load balancer (like [F5](https://www.f5.com/) ) to provide a virtual ip (vip) for kubeapi server High Availability. Especially for mission critical environments where an internal load balancer (For example: Kubernetes hosted solutions like [keepalived](https://keepalived.readthedocs.io/en/latest/introduction.html) or [kubevip](https://github.com/kube-vip/kube-vip) ) may not provide the required fault tolerance or throughput. Also, these solution use ARP protocol, and thus require the VIP to be in the same subnet as the nodes, which may not always be feasible. 
This external load balancer-provided vip, however, must be created before provisioning the cluster as this is the endpoint used by all the nodes to join and form the cluster. This is fine when the nodes are pre-provisioned, but what about cluster creation methods like [CAPV](https://github.com/kubernetes-sigs/cluster-api-provider-vsphere) (Cluster API vSphere) where the nodes are provisioned along with the rest of the cluster creation and the IP is not known before hand? 
We could use a hacky solution where we create the VIP at the time of cluster creation and let the cluster creation process fail until we manually add a backend after an IP is allocated to the first control plane node. This would be extremely painful and we would have to time it perfectly for everything to go well. 

Hopefully that explains why a predefined IP Address range is required. 

# The Solution

Now that we understand why we need a static IP Address range for Nodes, let's see how to implement this for a [CAPV](https://github.com/kubernetes-sigs/cluster-api-provider-vsphere) provisioner.

The solution requires two components to be deployed to the CAPI cluster:
1. [metal3 ipam provider](https://github.com/metal3-io/ip-address-manager.git)
2. [vsphere ipam adpater](https://github.com/spectrocloud/cluster-api-provider-vsphere-static-ip.git)

The first component provides the core [IPAM](https://en.wikipedia.org/wiki/IP_address_management) provider capabilities and the second component works as an adapter between [CAPV](https://github.com/kubernetes-sigs/cluster-api-provider-vsphere) (i.e. the vSphere CAPI provisioner itself) and the IPAM provider that is orginally meant for [metal3](https://metal3.io/) CAPI provider.

## Prerequisites: 
1. A Working CAPI enabled kubernetes cluster with CAPV provider. Either deploy a KIND cluster and then manually install CAPI components on it or simply use DKP to do it by running `dkp create bootstrap`. More details here:
https://docs.d2iq.com/dkp/latest/vsphere-bootstrap 
2. Usable Pool of IP Addresses
> The following images are used:
> - quay.io/metal3-io/ip-address-manager:main
> - arvindbhoj/capv-static-ip:1.0.0 #This can also be built from scratch from https://github.com/spectrocloud/cluster-api-provider-vsphere-static-ip.git
> - gcr.io/kubebuilder/kube-rbac-proxy:v0.5.0
> 
>For an airgapped setup using a KIND bootstrap cluster, follow these steps to upload the images to it:
> - Firstly, download the images to a machine that has internet connectivity using docker cli (e.g. `docker pull quay.io/metal3-io/ip-address-manager:main`)
> - Save the images as tar files using docker cli (e.g. `docker save quay.io/metal3-io/ip-address-manager:main > ip-address-manager.tar`)
> -  Now upload the tars to the airgapped server hosting the bootstrap cluster and use `docker load` to load the images into the local docker instance (e.g. `docker load -i ip-address-manager.tar` ) 
> - Finally load the images to the KIND cluster using KIND cli (download from cli from https://github.com/kubernetes-sigs/kind/releases) (e.g. `kind load docker-image quay.io/metal3-io/ip-address-manager:main --name=konvoy-capi-bootstrapper`. Where, `konvoy-capi-bootstrapper` is the name of the kind cluster created by DKP bootstrap. If using a different mechanism of deploying the kind cluster then get the name of the cluster using `kind get clusters` and use in the above command as the cluster name).

## Steps to Deploy

### Step 1: Clone the vsphere-ipam git repository

```
git clone https://github.com/arbhoj/vsphere-ipam.git
```

### Step 2: Deploy metal3 ipam components to the CAPI cluster

```
kubectl create -f metal3ipam/provider-components/infrastructure-components.yaml
```
> This will create CRD's like ippool, ipaddresses and ipclaims along with the `ipam-controller-manager` deployment for the controller. It uses the `quay.io/metal3-io/ip-address-manager:main` image. Download, retag and push the images to a local registry and change the deployment spec to point to a local image registry for airgapped environments

### Step 3: Deploy the vsphere ipam adapter

```
kubectl create -f spectro-ipam-adapter/install.yaml
```
>This will create the ipam adapter deployment for capv in the capv-system namespace with the required RBAC. It uses `arvindbhoj/capv-static-ip:1.0.0` and `gcr.io/kubebuilder/kube-rbac-proxy:v0.5.0` images. Download, retag and push the images to a local registry and change the deployment spec to point to a local image registry for airgapped environments

### Step 4: Define the IP Address range for the cluster being provisioned

>Note: The following is using examples to make it easier to explain what sample values would look like. Modify these as required.

```
export CLUSTER_NAME=dkp-demo
export NETWORK_NAME=Public #This is the name of the network to be used in vSphere
export START_IP=15.235.38.172
export END_IP=15.235.38.176
export CIDR=27
export GATEWAY=15.235.38.190
export DNS_SERVER=8.8.8.8,8.8.4.4

kubectl apply -f - <<EOF
apiVersion: ipam.metal3.io/v1alpha1
kind: IPPool
metadata:
  name: ${CLUSTER_NAME}-pool
  labels:
    cluster.x-k8s.io/network-name: ${NETWORK_NAME}
spec:
  clusterName: ${CLUSTER_NAME}
  namePrefix: ${CLUSTER_NAME}-prov
  pools:
    - start: ${START_IP}
      end: ${END_IP}
      prefix: ${CIDR}
      gateway: ${GATEWAY}
  prefix: 27
  gateway: ${GATEWAY}
  dnsServers: [${DNS_SERVER}]
EOF
```
>Change the IP Pool name, network-name label and ip address pool, gateway and dnsServer details as required.

### Step 5: Generate the manifests for deploying a vSphere cluster via cluster api. 

This would be something like this for a [DKP](https://docs.d2iq.com/dkp/2.3/create-new-vsphere-cluster) cluster. 
>Note: The following example is deploying kube-vip to manage the control plane vip and binding it to eth0 interface. If control plane VIP is being managed by an external LB/Proxy, open the generated manifest and delete the kube-vip deployment spec from under the files section of kubeadmcontrolplane. 
```
export CLUSTER_NAME=dkp-demo
export NETWORK=Public
export CONTROL_PLANE_ENDPOINT=xxx.xxx.xxx.xxx
export DATACENTER=dc1
export DATASTORE=datastore_name
export VM_FOLDER=folder_path
export VCENTER=vcenter_host
export SSH_PUB_KEY=path_to_ssh_public_key
export RESOURCE_POOL=vcenter_resource_pool_name
export VCENTER_TEMPLATE=capi_compatible_os_template
dkp create cluster vsphere --cluster-name=${CLUSTER_NAME} --network=${NETWORK} --control-plane-endpoint-host=${CONTROL_PLANE_ENDPOINT} --data-center=${DATACENTER} --data-store=${DATASTORE} --folder=${VM_FOLDER} --server=${VCENTER} --ssh-public-key-file=${SSH_PUB_KEY} --resource-pool=${RESOURCE_POOL} --vm-template=${VCENTER_TEMPLATE} --virtual-ip-interface=eth0 --dry-run -o yaml > dkp-cluster.yaml
```

In the cluster deployment manifest, update the VsphereMachineTemplate resource for the set of nodes that are to source the IP from the defined pool as shown below:
1. Add the `cluster.x-k8s.io/ip-pool-name: ${CLUSTER_NAME}` label. This points to the pool that was created in the last step and ties the MachineTemplate to the pool.
2. Disable dhcp4 and dhcp6

e.g.
```
apiVersion: infrastructure.cluster.x-k8s.io/v1beta1
kind: VSphereMachineTemplate
metadata:
  name: dkp-cluster-control-plane
  namespace: default
  labels:
    cluster.x-k8s.io/ip-pool-name: ${CLUSTER_NAME}-pool
spec:
  template:
    spec:
      cloneMode: fullClone
      datacenter: dc1
      datastore: ${DATASTORE}
      diskGiB: 80
      folder: ${VM_FOLDER}
      memoryMiB: 16384
      network:
        devices:
        - dhcp4: false
          dhcp6: false
          networkName: ${NETWORK}
      numCPUs: 4
      resourcePool: ${RESOURCE_POOL}
      server: ${VCENTER}
      template: ${capi_compatible_os_template}
```
### Step 6: Deploy the cluster by deploying the resources defined in the manifest to the CAPI cluster

e.g.
```
kubectl create -f dkp-cluster.yaml
```

This will deploy a vSphere cluster with the IP's from the range specified in the IPPOOL resource instead of randomly picking an IP from DHCP. 

Well. That's it. Hope your found this useful.