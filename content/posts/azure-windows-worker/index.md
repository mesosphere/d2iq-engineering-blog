---
authors: ["ksahm"]
title: "Run DKP with Windows worker nodes on Azure"
date: 2022-10-24T11:03:44+02:00
featured: false
tags: ["Azure", "Kubernetes", "DKP", "Windows"]
excerpt: "Learn how to add Windows worker node pool to Azure based DKP cluster" 
feature_image: feature.png
---

# Run DKP on OpenStack with Cluster API (CAPI)

The D2iQ Kubernetes Platform (DKP) makes your operational life easier. Instead of wasting time researching the CNCF landscape for the right tools to solve your enterprise requirements, and struggling with the implementation and lifecycle, you can use a fully curated, integrated, and supported Day 2 ready, out-of-the-box platform.
DKP supported CAPI infrastructures provide an easy to use infrastructure-as-code approach that eliminates the headache around the complexity of the development and lifecycle challenges of Kubernetes. DKP supports the following infrastructure providers out of the box:

* [AKS][capz]
* [AWS][capa]
* [Azure][capz]
* [EKS][capa]
* [GCP][capg]
* Preprovisioned (based on Ansible, requires SSH)
* [VMware vSphere][capv]

For more information about the supported CAPI providers, check out the official DKP documentation: [Advanced configuration][advanced configuration]

Besides the pre-integrated, supported providers, you can bring in any other CAPI provider.
This blog post shows you the needed steps to run DKP on OpenStack by using the OpenStack CAPI provider.

Note: all additional CAPI providers, which are not part of DKP, are not supported by D2iQ. 

## What is CAPI?

Kubernetes Cluster API (CAPI) is an official subproject from Kubernetes. The goal of CAPI is to provide a modular framework for deployment and lifecycle management of Kubernetes clusters. At a glance, CAPI provides a declarative API and a toolset (for example `clusterctl`) to create and manage Kubernetes clusters as a Kubernetes object.
A big benefit of CAPI is the large number of infrastructure providers (24+). This provider brings in all the required integrations for the infrastructure and handles the infrastructure as code lifecycle. The user does not need to think about infrastructure topics like how virtual machines are provisioned or how to create a NAT gateway. Just define how many control plane and worker nodes, with flavor, with operating system and CAPI will deploy the cluster.

For more information, see the [official CAPI documentation][CAPI docs]

## Prerequisites / Environment

To start with the deployment of your cluster at Azure, you need the following tools and information:
* DKP command line tool (version 2.3+)
* [kubectl][kubectl] command line tool
* Local installed Docker
* [Azure cli][azcli] tool
* Azure account

## Create the base DKP cluster on Azure
First you need a default DKP cluster on Azure with Linux control plane and worker nodes to run the Linux based core components.
DKP is based on Cluster API and use the `CAPZ` provider for deployment and lifecycle of Kubernetes clusters on Azure. 
All needed requirements and a detailed description you can found at the official DKP documentation [Azure quick start guide][dkp-azure-requirements]

You need to export a bunch of environment variables to start:
````
export AZURE_CLIENT_ID="<client id>"
export AZURE_TENANT_ID="<tenant id>"
export AZURE_CLIENT_SECRET='<client secret>'
export AZURE_SUBSCRIPTION_ID="<subscription id>"

export AZURE_SUBSCRIPTION_ID_B64="$(echo -n "$AZURE_SUBSCRIPTION_ID" | base64 | tr -d '\n')"
export AZURE_TENANT_ID_B64="$(echo -n "$AZURE_TENANT_ID" | base64 | tr -d '\n')"
export AZURE_CLIENT_ID_B64="$(echo -n "$AZURE_CLIENT_ID" | base64 | tr -d '\n')"
export AZURE_CLIENT_SECRET_B64="$(echo -n "$AZURE_CLIENT_SECRET" | base64 | tr -d '\n')"
````
This environment variables includes your Azure credentials to communicate with the Azure api. P lease fill in your `client id`, `tenant id`, `client secret` and `subscription id`. The last 4 variables convert your input to Base64 encoded strings which will be handed over to DKP in the next steps.

Now you need to define your base cluster:
````
export CLUSTER_NAME="myazurecluster"
export AZURE_LOCATION="westus"
export CONTROL_PLANE_MACHINE_COUNT=3
export WORKER_MACHINE_COUNT=3
export KUBERNETES_VERSION=1.23.12
export SSH_PUBLIC_KEY_FILE=~/.ssh/id_rsa.pub
export SSH_USER=capi
export AZURE_CONTROL_PLANE_MACHINE_TYPE="Standard_D4s_v3"
export AZURE_NODE_MACHINE_TYPE="Standard_D8s_v3"
export DKP_EXTRAVARS="--additional-tags expiration=8h,owner=ksahm"
````

With this informations you can start the DKP bootstrap and create the base cluster on Azure.
The bootstrap process is based on [KIND][kind]. For more information, please see the DKP docs section [Azure bootstrap][dkp-azure-bootstrap].
````
$ dkp create bootstrap
 ✓ Creating a bootstrap cluster 
 ✓ Initializing new CAPI components
````

If the bootstrap container is ready you can deploy the cluster by using the dkp command `dkp create cluster`:
````
$ dkp create cluster azure \
  -c ${CLUSTER_NAME} \
  --control-plane-machine-size ${AZURE_CONTROL_PLANE_MACHINE_TYPE} \
  --control-plane-replicas ${CONTROL_PLANE_MACHINE_COUNT} \
  --kubernetes-version ${KUBERNETES_VERSION} \
  --location ${AZURE_LOCATION} \
  --ssh-public-key-file ${SSH_PUBLIC_KEY_FILE} \
  --ssh-username ${SSH_USER} \
  --with-aws-bootstrap-credentials=false \
  --worker-machine-size ${AZURE_NODE_MACHINE_TYPE} \
  --worker-replicas ${WORKER_MACHINE_COUNT} \
  ${DKP_EXTRAVARS} 

Generating cluster resources
cluster.cluster.x-k8s.io/myazurecluster created
azurecluster.infrastructure.cluster.x-k8s.io/myazurecluster created
kubeadmcontrolplane.controlplane.cluster.x-k8s.io/myazurecluster-control-plane created
azuremachinetemplate.infrastructure.cluster.x-k8s.io/myazurecluster-control-plane created
secret/myazurecluster-etcd-encryption-config created
machinedeployment.cluster.x-k8s.io/myazurecluster-md-0 created
azuremachinetemplate.infrastructure.cluster.x-k8s.io/myazurecluster-md-0 created
kubeadmconfigtemplate.bootstrap.cluster.x-k8s.io/myazurecluster-md-0 created
clusterresourceset.addons.cluster.x-k8s.io/calico-cni-installation-myazurecluster created
configmap/calico-cni-installation-myazurecluster created
configmap/tigera-operator-myazurecluster created
clusterresourceset.addons.cluster.x-k8s.io/azure-disk-csi-myazurecluster created
configmap/azure-disk-csi-myazurecluster created
clusterresourceset.addons.cluster.x-k8s.io/cluster-autoscaler-myazurecluster created
configmap/cluster-autoscaler-myazurecluster created
clusterresourceset.addons.cluster.x-k8s.io/node-feature-discovery-myazurecluster created
configmap/node-feature-discovery-myazurecluster created
clusterresourceset.addons.cluster.x-k8s.io/nvidia-feature-discovery-myazurecluster created
configmap/nvidia-feature-discovery-myazurecluster created
````

Now your need to patch the `KubeadmControlPlane` object to enable the FeatureGate `WindowsHostProcessContainers`:
````
$ kubectl patch KubeadmControlPlane ${CLUSTER_NAME}-control-plane --type=merge -p '{"spec": {"kubeadmConfigSpec": {"clusterConfiguration": {"apiServer":{"extraArgs":{"feature-gates":"WindowsHostProcessContainers=true"}}}}}}'

kubeadmcontrolplane.controlplane.cluster.x-k8s.io/myazurecluster-control-plane patched
````

After this you can check the cluster status and wait until die cluster is build successfully.
````
$ dkp describe cluster -c ${CLUSTER_NAME}
NAME                                                               READY  SEVERITY  REASON  SINCE  MESSAGE
Cluster/myazurecluster                                             True                     54s           
├─ClusterInfrastructure - AzureCluster/myazurecluster              True                     10m           
├─ControlPlane - KubeadmControlPlane/myazurecluster-control-plane  True                     54s           
│ ├─Machine/myazurecluster-control-plane-52x8x                     True                     7m22s         
│ ├─Machine/myazurecluster-control-plane-nw2pm                     True                     4m9s          
│ └─Machine/myazurecluster-control-plane-xwmxx                     True                     71s           
└─Workers                                                                                                 
  └─MachineDeployment/myazurecluster-md-0                          True                     3m36s         
    ├─Machine/myazurecluster-md-0-7484fdb796-crgw2                 True                     3m37s         
    ├─Machine/myazurecluster-md-0-7484fdb796-fr4kq                 True                     4m40s         
    └─Machine/myazurecluster-md-0-7484fdb796-mf9rj                 True                     4m41s      
````

To communicate the with deployed cluster you need to download the generated kubeconfig. 
````
$ dkp get kubeconfig -c ${CLUSTER_NAME} > ${CLUSTER_NAME}.kubeconfig
````

You can validate the kubeconfig file if you try to list the nodes of the deployed cluster:
````
$ kubectl get nodes --kubeconfig ./${CLUSTER_NAME}.kubeconfig
NAME                                 STATUS     ROLES                  AGE     VERSION
myazurecluster-control-plane-2nxtq   Ready      control-plane,master   8m18s   v1.23.12
myazurecluster-control-plane-5pfjc   Ready      control-plane,master   5m9s    v1.23.12
myazurecluster-control-plane-g2h6j   Ready      control-plane,master   10m     v1.23.12
myazurecluster-md-0-blrqp            Ready      <none>                 8m26s   v1.23.12
myazurecluster-md-0-dwmrr            Ready      <none>                 8m32s   v1.23.12
myazurecluster-md-0-sppq8            Ready      <none>                 7m30s   v1.23.12
````

Now the base cluster is deployed.

### Patch node-feature-discovery
You need to patch the `node-feature-discovery-worker` DaemonSet to prevent that linux based pods of this DaemonSet are started on Windows workers.
This issue can be solved by this patch command:

````
$ kubectl patch ds -n node-feature-discovery node-feature-discovery-worker --kubeconfig ${CLUSTER_NAME}.kubeconfig --type=merge -p '{"spec": {"template": {"spec": {"nodeSelector":{"kubernetes.io/os":"linux"}}}}}'
````


## Create Windows node pool
To deploy the Windows worker you need to define a new, additional node pool and attach it to the deployed cluster.
A nodepool is a group of worker nodes, all nodes in the pool are sized equal. 

For this you need to export an additional set of environment variables to define our Windows node pool.
````
export WORKER_MACHINE_WINDOWS_COUNT=4
export AZURE_WINDOWS_NODE_MACHINE_TYPE="Standard_D8s_v3"
export AZURE_SSH_PUBLIC_KEY_B64="$(base64 -i ${SSH_PUBLIC_KEY_FILE})"
export AZURE_SSH_PUBLIC_KEY="$(cat ${SSH_PUBLIC_KEY_FILE})"
````
> Please note that the 4 environment variables are in *ADDITION* to the already exported variable.

Currently there is a version change of the Azure image urns. You need to use the Azure cli tool `az` to get the right version matching to your selected Kubernetes version and export them as variable. In this example Kubernetes version 1.23.12 is in use:
````
$ az vm image list --publisher cncf-upstream --all --sku windows-2022-containerd-gen1 --offer capi-windows -l ${AZURE_LOCATION}
...
  {
    "architecture": "x64",
    "offer": "capi-windows",
    "publisher": "cncf-upstream",
    "sku": "windows-2022-containerd-gen1",
    "urn": "cncf-upstream:capi-windows:windows-2022-containerd-gen1:123.12.20220922",
    "version": "123.12.20220922"
  },
...

$ export AZURE_URN_VERSION=123.12.20220922
````

After the definition you can generate the nodepool manifest: 
````
cat <<EOF > windows-node-pool.yml
---
apiVersion: cluster.x-k8s.io/v1beta1
kind: MachineDeployment
metadata:
  name: ${CLUSTER_NAME}-md-win
  namespace: default
spec:
  clusterName: ${CLUSTER_NAME}
  replicas: ${WORKER_MACHINE_WINDOWS_COUNT}
  selector:
    matchLabels: null
  template:
    spec:
      bootstrap:
        configRef:
          apiVersion: bootstrap.cluster.x-k8s.io/v1beta1
          kind: KubeadmConfigTemplate
          name: ${CLUSTER_NAME}-md-win
      clusterName: ${CLUSTER_NAME}
      infrastructureRef:
        apiVersion: infrastructure.cluster.x-k8s.io/v1beta1
        kind: AzureMachineTemplate
        name: ${CLUSTER_NAME}-md-win
      version: ${KUBERNETES_VERSION}
---
apiVersion: infrastructure.cluster.x-k8s.io/v1beta1
kind: AzureMachineTemplate
metadata:
  annotations:
    runtime: containerd
  name: ${CLUSTER_NAME}-md-win
  namespace: default
spec:
  template:
    metadata:
      annotations:
        runtime: containerd
    spec:
      image:
        marketplace:
          offer: capi-windows
          publisher: cncf-upstream
          sku: windows-2022-containerd-gen1
          version: ${AZURE_URN_VERSION}
      osDisk:
        diskSizeGB: 128
        managedDisk:
          storageAccountType: Premium_LRS
        osType: Windows
      sshPublicKey: ${AZURE_SSH_PUBLIC_KEY_B64:=""}
      vmSize: ${AZURE_WINDOWS_NODE_MACHINE_TYPE}
---
apiVersion: bootstrap.cluster.x-k8s.io/v1beta1
kind: KubeadmConfigTemplate
metadata:
  name: ${CLUSTER_NAME}-md-win
  namespace: default
spec:
  template:
    spec:
      files:
      - contentFrom:
          secret:
            key: worker-node-azure.json
            name: ${CLUSTER_NAME}-md-win-azure-json
        owner: root:root
        path: c:/k/azure.json
        permissions: "0644"
      - content: |-
          Add-MpPreference -ExclusionProcess C:/opt/cni/bin/calico.exe
          Add-MpPreference -ExclusionProcess C:/opt/cni/bin/calico-ipam.exe
        path: C:/defender-exclude-calico.ps1
        permissions: "0744"
      joinConfiguration:
        nodeRegistration:
          criSocket: npipe:////./pipe/containerd-containerd
          kubeletExtraArgs:
            azure-container-registry-config: c:/k/azure.json
            cloud-config: c:/k/azure.json
            cloud-provider: azure
            feature-gates: WindowsHostProcessContainers=true
            v: "2"
            windows-priorityclass: ABOVE_NORMAL_PRIORITY_CLASS
          name: '{{ ds.meta_data["local_hostname"] }}'
      postKubeadmCommands:
      - nssm set kubelet start SERVICE_AUTO_START
      - powershell C:/defender-exclude-calico.ps1
      preKubeadmCommands: []
      users:
      - groups: Administrators
        name: capi
        sshAuthorizedKeys:
        - ${AZURE_SSH_PUBLIC_KEY:=""}
EOF
````

Deploy the generated manifest and validate the cluster status:
````
$ kubectl apply -f windows-node-pool.yml 
machinedeployment.cluster.x-k8s.io/myazurecluster-md-win created
azuremachinetemplate.infrastructure.cluster.x-k8s.io/myazurecluster-md-win created
kubeadmconfigtemplate.bootstrap.cluster.x-k8s.io/myazurecluster-md-win created

$ dkp describe cluster -c ${CLUSTER_NAME}
NAME                                                               READY  SEVERITY  REASON                       SINCE  MESSAGE                                                      
Cluster/myazurecluster                                             True                                          6m20s                                                               
├─ClusterInfrastructure - AzureCluster/myazurecluster              True                                          15m                                                                 
├─ControlPlane - KubeadmControlPlane/myazurecluster-control-plane  True                                          6m20s                                                               
│ ├─Machine/myazurecluster-control-plane-52x8x                     True                                          12m                                                                 
│ ├─Machine/myazurecluster-control-plane-nw2pm                     True                                          9m35s                                                               
│ └─Machine/myazurecluster-control-plane-xwmxx                     True                                          6m37s                                                               
└─Workers                                                                                                                                                                            
  ├─MachineDeployment/myazurecluster-md-0                          True                                          9m2s                                                                
  │ ├─Machine/myazurecluster-md-0-7484fdb796-crgw2                 True                                          9m3s                                                                
  │ ├─Machine/myazurecluster-md-0-7484fdb796-fr4kq                 True                                          10m                                                                 
  │ └─Machine/myazurecluster-md-0-7484fdb796-mf9rj                 True                                          10m                                                                 
  └─MachineDeployment/myazurecluster-md-win                        False  Warning   WaitingForAvailableMachines  5m     Minimum availability requires 4 replicas, current 0 available
    ├─Machine/myazurecluster-md-win-64576cf5c4-2dxdl               True                                          84s                                                                 
    ├─Machine/myazurecluster-md-win-64576cf5c4-7sb98               True                                          29s                                                                 
    ├─Machine/myazurecluster-md-win-64576cf5c4-n8rgh               True                                          49s                                                                 
    └─Machine/myazurecluster-md-win-64576cf5c4-vg29x               True                                          63s

$ kubectl get nodes --kubeconfig ./${CLUSTER_NAME}.kubeconfig
NAME                                 STATUS     ROLES                  AGE     VERSION
myazurecl-72gtq                      NotReady   <none>                 2m35s   v1.23.12
myazurecl-ctw62                      NotReady   <none>                 116s    v1.23.12
myazurecl-f4x5q                      NotReady   <none>                 2m1s    v1.23.12
myazurecl-l8dws                      NotReady   <none>                 2m35s   v1.23.12
myazurecluster-control-plane-2nxtq   Ready      control-plane,master   10m     v1.23.12
myazurecluster-control-plane-5pfjc   Ready      control-plane,master   7m31s   v1.23.12
myazurecluster-control-plane-g2h6j   Ready      control-plane,master   13m     v1.23.12
myazurecluster-md-0-blrqp            Ready      <none>                 10m     v1.23.12
myazurecluster-md-0-dwmrr            Ready      <none>                 10m     v1.23.12
myazurecluster-md-0-sppq8            Ready      <none>                 9m52s   v1.23.12
````

The Windows worker stuck in status `NotReady` because the existing `Calico` DaemonSet is just for Linux nodes. 
So you need to deploy a Calico DaemonSet for Windows as well as a `Kube-Proxy` for Windows.

## Deploy Kube-Proxy to Windows nodes
For successful network connectivity you need to deploy `Kube-Proxy` to the Windows worker nodes. 
Kube-Proxy runs as a DaemonSet on all workers. You can easily deploy dedicated DaemonSet for the Windows workers:

````
cat <<EOF> kube-proxy-win.yml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  labels:
    k8s-app: kube-proxy
  name: kube-proxy-windows
  namespace: kube-system
spec:
  selector:
    matchLabels:
      k8s-app: kube-proxy-windows
  template:
    metadata:
      labels:
        k8s-app: kube-proxy-windows
    spec:
      serviceAccountName: kube-proxy
      securityContext:
        windowsOptions:
          hostProcess: true
          runAsUserName: 'NT AUTHORITY\system'
      hostNetwork: true
      containers:
      - image: sigwindowstools/kube-proxy:v${KUBERNETES_VERSION}-calico-hostprocess
        args: ["\$env:CONTAINER_SANDBOX_MOUNT_POINT/kube-proxy/start.ps1"]
        workingDir: "\$env:CONTAINER_SANDBOX_MOUNT_POINT/kube-proxy/"
        name: kube-proxy
        env:
        - name: NODE_NAME
          valueFrom:
            fieldRef:
              apiVersion: v1
              fieldPath: spec.nodeName
        - name: POD_IP
          valueFrom:
            fieldRef:
              fieldPath: status.podIP
        - name: KUBEPROXY_PATH
          valueFrom:
            configMapKeyRef:
              name: windows-kubeproxy-ci
              key: KUBEPROXY_PATH
              optional: true
        volumeMounts:
        - mountPath: /var/lib/kube-proxy
          name: kube-proxy
      nodeSelector:
        kubernetes.io/os: windows
      tolerations:
      - key: CriticalAddonsOnly
        operator: Exists
      - operator: Exists
      volumes:
      - configMap:
          name: kube-proxy
        name: kube-proxy
  updateStrategy:
    type: RollingUpdate
EOF

kubectl apply --kubeconfig ${CLUSTER_NAME}.kubeconfig -f kube-proxy-win.yml
````

## Deploy Calico to Windows nodes
The Calico DaemonSet for Windows needs some information of `kubeadm-config`. The ConfigMap is created in namespace `kube-system`.
Calico runs in namespace `calico-system`. If you don't want to run Calico parts in both namespaces you can copy the ConfigMap to the namespace `calico-system`:

````
$ kubectl get configmap kubeadm-config -n kube-system -o yaml --kubeconfig ${CLUSTER_NAME}.kubeconfig | sed 's/namespace: kube-system/namespace: calico-system/' | kubectl create --kubeconfig ${CLUSTER_NAME}.kubeconfig -f -
````

You have to pass some information to the DaemonSet. The following variables parse the needed information from the running Kubernetes cluster:
````
export KUBERNETES_SERVICE_CIDR=$(kubectl get cm kubeadm-config -n kube-system --kubeconfig ${CLUSTER_NAME}.kubeconfig  -o jsonpath='{.data.ClusterConfiguration}'|yq '.networking.serviceSubnet')
````

After the successful copy process, you create the ConfigMaps and the DaemonSet for the Calico for Windows: 
````
cat <<EOF > calico-windows.yml
---
apiVersion: crd.projectcalico.org/v1
kind: IPAMConfig
metadata:
  name: default
spec:
  autoAllocateBlocks: true
  strictAffinity: true
---
kind: ConfigMap
apiVersion: v1
metadata:
  name: calico-static-rules
  namespace: calico-system
  labels:
    tier: node
    app: calico
data:
  static-rules.json: |
    {
      "Provider": "azure",
      "Version": "0.1",
      "Rules": [
        {
          "Name": "EndpointPolicy",
          "Rule": {
              "Id": "wireserver",
              "Type": "ACL",
              "Protocol": 6,
              "Action": "Block",
              "Direction": "Out",
              "RemoteAddresses": "168.63.129.16/32",
              "RemotePorts": "80",
              "Priority": 200,
              "RuleType": "Switch"
            }
          }
      ]
    } 
---
kind: ConfigMap
apiVersion: v1
metadata:
  name: calico-config-windows
  namespace: calico-system
  labels:
    tier: node
    app: calico
data:
  veth_mtu: "1350"
  
  cni_network_config: |
    {
      "name": "Calico",
      "cniVersion": "0.3.1",
      "plugins": [
        {
          "windows_use_single_network": true,
          "type": "calico",
          "mode": "vxlan",
          "nodename": "__KUBERNETES_NODE_NAME__",
          "nodename_file_optional": true,
          "log_file_path": "c:/cni.log",
          "log_level": "debug",

          "vxlan_mac_prefix": "0E-2A",
          "vxlan_vni": 4096,
          "mtu": __CNI_MTU__,
          "policy": {
            "type": "k8s"
          },

          "log_level": "info",

          "capabilities": {"dns": true},
          "DNS":  {
            "Search":  [
              "svc.cluster.local"
            ]
          },

          "datastore_type": "kubernetes",

          "kubernetes": {
            "kubeconfig": "__KUBECONFIG_FILEPATH__"
          },

          "ipam": {
            "type": "calico-ipam",
            "subnet": "usePodCidr"
          },

          "policies":  [
            {
              "Name":  "EndpointPolicy",
              "Value":  {
                "Type":  "OutBoundNAT",
                "ExceptionList":  [
                  "__K8S_SERVICE_CIDR__"
                ]
              }
            },
            {
              "Name":  "EndpointPolicy",
              "Value":  {
                "Type":  "SDNROUTE",
                "DestinationPrefix":  "__K8S_SERVICE_CIDR__",
                "NeedEncap":  true
              }
            }
          ]
        }
      ]

    }
---
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: calico-node-windows
  labels:
    tier: node
    app: calico
  namespace: calico-system
spec:
  selector:
    matchLabels:
      app: calico
  template:
    metadata:
      labels:
        tier: node
        app: calico
    spec:
      securityContext:
        windowsOptions:
          hostProcess: true
          runAsUserName: "NT AUTHORITY\\\\system"
      hostNetwork: true
      serviceAccountName: calico-node
      nodeSelector:
        kubernetes.io/os: windows
      tolerations:
      - operator: Exists
        effect: NoSchedule
        # Mark the pod as a critical add-on for rescheduling.
      - key: CriticalAddonsOnly
        operator: Exists
      - effect: NoExecute
        operator: Exists
      initContainers:
        # This container installs the CNI binaries
        # and CNI network config file on each node.
        - name: install-cni
          image: sigwindowstools/calico-install:v3.23.0-hostprocess
          args: ["\$env:CONTAINER_SANDBOX_MOUNT_POINT/calico/install.ps1"]
          imagePullPolicy: Always
          env:
            # Name of the CNI config file to create.
            - name: CNI_CONF_NAME
              value: "10-calico.conflist"
            # The CNI network config to install on each node.
            - name: CNI_NETWORK_CONFIG
              valueFrom:
                configMapKeyRef:
                  name: calico-config-windows
                  key: cni_network_config
            # Set the hostname based on the k8s node name.
            - name: KUBERNETES_NODE_NAME
              valueFrom:
                fieldRef:
                  fieldPath: spec.nodeName
            # CNI MTU Config variable
            - name: CNI_MTU
              valueFrom:
                configMapKeyRef:
                  name: calico-config-windows
                  key: veth_mtu
            # Prevents the container from sleeping forever.
            - name: SLEEP
              value: "false"
            - name: K8S_SERVICE_CIDR
              value: "${KUBERNETES_SERVICE_CIDR}"
          volumeMounts:
            - mountPath: /host/opt/cni/bin
              name: cni-bin-dir
            - mountPath: /host/etc/cni/net.d
              name: cni-net-dir
            - name: kubeadm-config
              mountPath: /etc/kubeadm-config/
          securityContext:
            windowsOptions:
              hostProcess: true
              runAsUserName: "NT AUTHORITY\\\\system"
      containers:
      - name: calico-node-startup
        image: sigwindowstools/calico-node:v3.23.0-hostprocess
        args: ["\$env:CONTAINER_SANDBOX_MOUNT_POINT/calico/node-service.ps1"]
        workingDir: "\$env:CONTAINER_SANDBOX_MOUNT_POINT/calico/"
        imagePullPolicy: Always
        volumeMounts:
        - name: calico-config-windows
          mountPath: /etc/kube-calico-windows/
        env:
        - name: POD_NAME
          valueFrom:
            fieldRef:
              apiVersion: v1
              fieldPath: metadata.name
        - name: POD_NAMESPACE
          valueFrom:
            fieldRef:
              apiVersion: v1
              fieldPath: metadata.namespace
        - name: CNI_IPAM_TYPE
          value: "calico-ipam"
        - name: CALICO_NETWORKING_BACKEND
          value: "vxlan"
        - name: KUBECONFIG
          value: "C:/etc/cni/net.d/calico-kubeconfig"
        - name: VXLAN_VNI
          value: "4096"
      - name: calico-node-felix
        image: sigwindowstools/calico-node:v3.23.0-hostprocess
        args: ["\$env:CONTAINER_SANDBOX_MOUNT_POINT/calico/felix-service.ps1"]
        imagePullPolicy: Always
        workingDir: "\$env:CONTAINER_SANDBOX_MOUNT_POINT/calico/"
        volumeMounts:
        - name: calico-config-windows
          mountPath: /etc/kube-calico-windows/
        - name: calico-static-rules
          mountPath: /calico/static-rules.json
          subPath: static-rules.json
        env:
        - name: POD_NAME
          valueFrom:
            fieldRef:
              apiVersion: v1
              fieldPath: metadata.name
        - name: POD_NAMESPACE
          valueFrom:
            fieldRef:
              apiVersion: v1
              fieldPath: metadata.namespace
        - name: VXLAN_VNI
          value: "4096"
        - name: KUBECONFIG
          value: "C:/etc/cni/net.d/calico-kubeconfig"
      volumes:
      - name: calico-config-windows
        configMap:
          name: calico-config-windows
      - name: calico-static-rules
        configMap:
          name: calico-static-rules
      # Used to install CNI.
      - name: cni-bin-dir
        hostPath:
          path: /opt/cni/bin
      - name: cni-net-dir
        hostPath:
          path: /etc/cni/net.d
      - name: kubeadm-config
        configMap:
          name: kubeadm-config
EOF
````

The generated yaml manifest needs to be applied to the running Azure cluster by using the generated kubeconfig.
````
$ kubectl apply -f calico-windows.yml --kubeconfig ${CLUSTER_NAME}.kubeconfig
configmap/calico-windows-config created
daemonset.apps/calico-node-windows created
````

Now you can check if the calico pods are running on the Windows nodes and if the status of the worker nodes is now `Ready`.
````
$ kubectl get po -n calico-system --kubeconfig ${CLUSTER_NAME}.kubeconfig -o wide
NAME                                       READY   STATUS    RESTARTS   AGE   IP               NODE                                 NOMINATED NODE   READINESS GATES
calico-kube-controllers-577c696df9-7fbq9   1/1     Running   0          22m   192.168.116.65   myazurecluster-control-plane-g2h6j   <none>           <none>
calico-node-585j6                          1/1     Running   0          22m   10.0.0.4         myazurecluster-control-plane-g2h6j   <none>           <none>
calico-node-f8tv4                          1/1     Running   0          20m   10.0.0.5         myazurecluster-control-plane-2nxtq   <none>           <none>
calico-node-kqctn                          1/1     Running   0          21m   10.1.0.5         myazurecluster-md-0-blrqp            <none>           <none>
calico-node-svpr9                          1/1     Running   0          17m   10.0.0.6         myazurecluster-control-plane-5pfjc   <none>           <none>
calico-node-w9tt2                          1/1     Running   0          21m   10.1.0.6         myazurecluster-md-0-dwmrr            <none>           <none>
calico-node-windows-b86pq                  2/2     Running   0          86s   10.1.0.9         myazurecl-l8dws                      <none>           <none>
calico-node-windows-fr494                  2/2     Running   0          86s   10.1.0.8         myazurecl-f4x5q                      <none>           <none>
calico-node-windows-fspbr                  2/2     Running   0          86s   10.1.0.7         myazurecl-72gtq                      <none>           <none>
calico-node-windows-l9mjg                  2/2     Running   0          86s   10.1.0.10        myazurecl-ctw62                      <none>           <none>
calico-node-xspt2                          1/1     Running   0          20m   10.1.0.4         myazurecluster-md-0-sppq8            <none>           <none>
calico-typha-76c5c4b77d-2m4hr              1/1     Running   0          19m   10.1.0.6         myazurecluster-md-0-dwmrr            <none>           <none>
calico-typha-76c5c4b77d-8ccmd              1/1     Running   0          22m   10.0.0.4         myazurecluster-control-plane-g2h6j   <none>           <none>
calico-typha-76c5c4b77d-spmb7              1/1     Running   0          20m   10.1.0.5         myazurecluster-md-0-blrqp            <none>           <none>

$ kubectl get no --kubeconfig ${CLUSTER_NAME}.kubeconfig -o wide
NAME                                 STATUS   ROLES                  AGE   VERSION    INTERNAL-IP   EXTERNAL-IP   OS-IMAGE                         KERNEL-VERSION      CONTAINER-RUNTIME
myazurecl-72gtq                      Ready    <none>                 13m   v1.23.12   10.1.0.7      <none>        Windows Server 2022 Datacenter   10.0.20348.1006     containerd://1.6.2
myazurecl-ctw62                      Ready    <none>                 12m   v1.23.12   10.1.0.10     <none>        Windows Server 2022 Datacenter   10.0.20348.1006     containerd://1.6.2
myazurecl-f4x5q                      Ready    <none>                 12m   v1.23.12   10.1.0.8      <none>        Windows Server 2022 Datacenter   10.0.20348.1006     containerd://1.6.2
myazurecl-l8dws                      Ready    <none>                 13m   v1.23.12   10.1.0.9      <none>        Windows Server 2022 Datacenter   10.0.20348.1006     containerd://1.6.2
myazurecluster-control-plane-2nxtq   Ready    control-plane,master   21m   v1.23.12   10.0.0.5      <none>        Ubuntu 20.04.5 LTS               5.15.0-1020-azure   containerd://1.6.2
myazurecluster-control-plane-5pfjc   Ready    control-plane,master   18m   v1.23.12   10.0.0.6      <none>        Ubuntu 20.04.5 LTS               5.15.0-1020-azure   containerd://1.6.2
myazurecluster-control-plane-g2h6j   Ready    control-plane,master   23m   v1.23.12   10.0.0.4      <none>        Ubuntu 20.04.5 LTS               5.15.0-1020-azure   containerd://1.6.2
myazurecluster-md-0-blrqp            Ready    <none>                 21m   v1.23.12   10.1.0.5      <none>        Ubuntu 20.04.5 LTS               5.15.0-1020-azure   containerd://1.6.2
myazurecluster-md-0-dwmrr            Ready    <none>                 21m   v1.23.12   10.1.0.6      <none>        Ubuntu 20.04.5 LTS               5.15.0-1020-azure   containerd://1.6.2
myazurecluster-md-0-sppq8            Ready    <none>                 20m   v1.23.12   10.1.0.4      <none>        Ubuntu 20.04.5 LTS               5.15.0-1020-azure   containerd://1.6.2
````


## Deploy a demo application
You can test the functionality of the Windows Kubernetes worker with a small demo deployment of an IIS webserver:

````
cat <<EOF> iis.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: iis-1809
  labels:
    app: iis-1809
spec:
  replicas: 1
  template:
    metadata:
      name: iis-1809
      labels:
        app: iis-1809
    spec:
      containers:
      - name: iis
        image: mcr.microsoft.com/windows/servercore/iis:windowsservercore-ltsc2022
        resources:
          limits:
            cpu: 1
            memory: 800m
          requests:
            cpu: .1
            memory: 300m
        ports:
          - containerPort: 80
      nodeSelector:
        "kubernetes.io/os": windows
  selector:
    matchLabels:
      app: iis-1809
---
apiVersion: v1
kind: Service
metadata:
  name: iis
spec:
  type: LoadBalancer
  ports:
  - protocol: TCP
    port: 80
  selector:
    app: iis-1809
EOF

kubectl apply -f iis.yaml --kubeconfig ${CLUSTER_NAME}.kubeconfig
````

Validate the deployment:
````
$ kubectl get po,svc --kubeconfig ${CLUSTER_NAME}.kubeconfig
NAME                            READY   STATUS    RESTARTS   AGE
pod/iis-1809-5745f49584-gsqml   1/1     Running   0          7m4s

NAME                 TYPE           CLUSTER-IP     EXTERNAL-IP    PORT(S)        AGE
service/iis          LoadBalancer   10.102.12.86   40.78.50.251   80:30911/TCP   15m
service/kubernetes   ClusterIP      10.96.0.1      <none>         443/TCP        71m
````

If the pod is in state `Running` and the service `iis` got an external ip address via Azure Loadbalancer you can test the deployed webservice via browser or curl:

````
curl http://40.78.50.251
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1" />
<title>IIS Windows Server</title>
<style type="text/css">
<!--
body {
        color:#000000;
        background-color:#0072C6;
        margin:0;
}

#container {
        margin-left:auto;
        margin-right:auto;
        text-align:center;
        }

a img {
        border:none;
}

-->
</style>
</head>
<body>
<div id="container">
<a href="http://go.microsoft.com/fwlink/?linkid=66138&amp;clcid=0x409"><img src="iisstart.png" alt="IIS" width="960" height="600" /></a>
</div>
</body>
</html>
````

The test was sucessful. The workload is started on the Windows nodes and service is accessable.


## Attach to DKP Enterprise (optional)
If you want to attach the cluster to DKP Enterprise you need to update the Application settings before you attach the cluster to DKP Enterprise.
These changes make sure that components like Traefik or Gatekeeper are scheduled on Linux nodes only.

The following overrides are needed for the named `Cluster Applications` (via DKP UI/CLI):

### Gatekeeper
````
nodeSelector:
  kubernetes.io/os: linux
````

### Kube Monitoring
````
alertmanager:
  alertmanagerSpec:
    nodeSelector: 
      kubernetes.io/os: linux
prometheusOperator:
  admissionWebhooks:
    patch:
      nodeSelector:
        kubernetes.io/os: linux
prometheusOperator:
  nodeSelector:
    kubernetes.io/os: linux
prometheus:
  prometheusSpec:
    nodeSelector:
      kubernetes.io/os: linux
prometheus-node-exporter:
  nodeSelector:
    kubernetes.io/os: linux
````

### Kubernetes Dashboard
````
nodeSelector:
  kubernetes.io/os: linux
````

### Prometheus Adapter
````
nodeSelector:
  kubernetes.io/os: linux
````

### Reloader
````
reloader:
  deployment:
    nodeSelector:
      kubernetes.io/os: linux
````

### Traefik
````
nodeSelector:
  kubernetes.io/os: linux
````

[CAPI docs]: https://cluster-api.sigs.k8s.io/
[kubectl]: https://kubernetes.io/docs/tasks/tools/
[calico]: https://www.tigera.io/project-calico/
[calico quickstart]: https://projectcalico.docs.tigera.io/getting-started/kubernetes/quickstart
[capa]: https://cluster-api-aws.sigs.k8s.io/
[capz]: https://capz.sigs.k8s.io/
[capg]: https://github.com/kubernetes-sigs/cluster-api-provider-gcp
[capv]: https://github.com/kubernetes-sigs/cluster-api-provider-vsphere
[kind]: https://kind.sigs.k8s.io/
[azcli]: https://learn.microsoft.com/en-us/cli/azure/install-azure-cli
[dkp-azure-requirements]: https://docs.d2iq.com/dkp/latest/azure-prerequisites
[dkp-azure-bootstrap]: https://docs.d2iq.com/dkp/latest/azure-bootstrap
