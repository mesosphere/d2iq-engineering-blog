---
authors: ["dkoshkin"]
title: "Adopting existing clusters to use ClusterClass"
date: 2023-03-06T15:24:31Z
featured: false
tags: ["cluster api", "capi" ]
excerpt: "Learn how to adopt your existing CAPI cluster to use ClusterClass."
feature_image: feature.png
---

## What is ClusterClass?

The [ClusterClass feature](https://cluster-api.sigs.k8s.io/tasks/experimental-features/cluster-class/index.html) is an important evolution of the Cluster API project. Although it is still an alpha feature, CAPI core and many of the infrastructure providers are working hard to provide support for it. You can read more about the different motivation and goals of ClusterClass in the original [proposal](https://github.com/kubernetes-sigs/cluster-api/blob/main/docs/proposals/20210526-cluster-class-and-managed-topologies.md#clusterclass), but the one I'm most excited for is declarative Kubernetes version upgrades.

When performing a regular Cluster API cluster upgrade, you must have something that will sequentially trigger an upgrade of the control-plane, wait for that upgrade to complete, start the upgrade of each of your MachineDeployments and wait for those to finish. ClusterClass greatly simplifies this flow, by letting you change a single version value in the `Cluster` object and having the new topology reconcile the change for use in the correct order across the whole cluster.

In this post, I will show you how to adopt an existing Cluster API Docker (CAPD) cluster to use the ClusterClass feature. You can apply the same steps for any of your clusters as long as they are using [CABPK](https://cluster-api.sigs.k8s.io/tasks/bootstrap/kubeadm-bootstrap.html?highlight=cabp#how-does-cabpk-work) and [MachineDeployments](https://cluster-api.sigs.k8s.io/user/concepts.html?highlight=machinedepl#machinedeployment).

## Create a CAPD Cluster

1.  Create a bootstrap cluster by following the [Quickstart](https://cluster-api.sigs.k8s.io/user/quick-start.html).


2.  Deploy the `docker` infrastructure provider:

    ```shell
    export CLUSTER_TOPOLOGY=true
    clusterctl init --infrastructure docker
    ```

3.  Create the base CAPD cluster:

    ```shell
    export CLUSTER_NAME=cc-migration-demo
    export NAMESPACE=default
    export KUBERNETES_VERSION=v1.25.3
    curl -s https://gist.githubusercontent.com/dkoshkin/cf863e8c1189bbec990fa5b81364bd20/raw/2f708f6743f30f323a8a129c147e1b8afed2c299/cluster.yaml.tmpl | envsubst | kubectl apply -f -
    ```

4.  Fetch the kubeconfig for the CAPD cluster:

    ```shell
    clusterctl get kubeconfig $CLUSTER_NAME > $CLUSTER_NAME.conf
    ```

5.  If you are using macOS you can update the generated kubeconfig with the correct `server` address:

    ```shell
    kubectl config set-cluster $CLUSTER_NAME \
    --kubeconfig $CLUSTER_NAME.conf \
    --server=https://$(docker port $CLUSTER_NAME-lb 6443/tcp)
    ```

6.  Deploy Calico CNI:

    ```shell
    kubectl --kubeconfig $CLUSTER_NAME.conf apply -f https://raw.githubusercontent.com/projectcalico/calico/v3.24.1/manifests/calico.yaml
    ```

After a few minutes all the Nodes will become `Ready`.

## Adopt the CAPD Cluster

At a high level, we will:

1. Create a `ClusterClass` resource specific to our cluster, and missing template `DockerClusterTemplate` and `KubeadmControlPlaneTemplate` resources.
2. Annotate, label, and patch existing cluster resources with required values to what the topology controller expects it to be.
3. Patch the `Cluster` object to use the new `ClusterClass`.

###  Create new resources

1.  Create a `ClusterClass` resource with the same `$CLUSTER_NAME`:

    ```shell
    cat <<EOF | kubectl apply -f -
    apiVersion: cluster.x-k8s.io/v1beta1
    kind: ClusterClass
    metadata:
      name: ${CLUSTER_NAME}
      namespace: ${NAMESPACE}
      labels:
        cluster.x-k8s.io/provider: docker
    spec:
      controlPlane:
        ref:
          apiVersion: controlplane.cluster.x-k8s.io/v1beta1
          kind: KubeadmControlPlaneTemplate
          name: ${CLUSTER_NAME}-control-plane
        machineInfrastructure:
          ref:
            kind: DockerMachineTemplate
            apiVersion: infrastructure.cluster.x-k8s.io/v1beta1
            name: ${CLUSTER_NAME}-control-plane
      infrastructure:
        ref:
          apiVersion: infrastructure.cluster.x-k8s.io/v1beta1
          kind: DockerClusterTemplate
          name: ${CLUSTER_NAME}-cluster
      workers:
        machineDeployments:
          - class: ${CLUSTER_NAME}-md-0
            template:
              bootstrap:
                ref:
                  apiVersion: bootstrap.cluster.x-k8s.io/v1beta1
                  kind: KubeadmConfigTemplate
                  name: ${CLUSTER_NAME}-md-0
              infrastructure:
                ref:
                  apiVersion: infrastructure.cluster.x-k8s.io/v1beta1
                  kind: DockerMachineTemplate
                  name: ${CLUSTER_NAME}-md-0
    EOF
    ```


2.  Create `DockerClusterTemplate` and `KubeadmControlPlaneTemplate` resources. You will want to base these on the specs of `DockerCluster` and the `KubeadmControlPlane` of your cluster:

    ```shell
    cat <<EOF | kubectl apply -f -
    apiVersion: infrastructure.cluster.x-k8s.io/v1beta1
    kind: DockerClusterTemplate
    metadata:
      name: ${CLUSTER_NAME}-cluster
    spec:
      template:
        spec:
          controlPlaneEndpoint:
            host: 172.19.0.3
            port: 6443
          loadBalancer: {}
    ---
    kind: KubeadmControlPlaneTemplate
    apiVersion: controlplane.cluster.x-k8s.io/v1beta1
    metadata:
      name: ${CLUSTER_NAME}-control-plane
      namespace: ${NAMESPACE}
    spec:
      template:
        spec:
          kubeadmConfigSpec:
            clusterConfiguration:
              apiServer:
                certSANs:
                  - localhost
                  - 127.0.0.1
                  - 0.0.0.0
              controllerManager:
                extraArgs:
                  enable-hostpath-provisioner: 'true'
              dns: {}
              etcd: {}
              networking: {}
              scheduler: {}
            format: cloud-config
            initConfiguration:
              localAPIEndpoint: {}
              nodeRegistration:
                criSocket: /var/run/containerd/containerd.sock
                kubeletExtraArgs:
                  cgroup-driver: systemd
                  eviction-hard: nodefs.available<0%,nodefs.inodesFree<0%,imagefs.available<0%
            joinConfiguration:
              discovery: {}
              nodeRegistration:
                criSocket: /var/run/containerd/containerd.sock
                kubeletExtraArgs:
                  cgroup-driver: systemd
                  eviction-hard: nodefs.available<0%,nodefs.inodesFree<0%,imagefs.available<0%
    EOF
    ```
    
### Annotate, Label, and Patch Cluster resources

1. A webhook will disallow adding the topology section to an existing cluster, add this annotation to disable webhook check:

    ```shell
    kubectl annotate cluster $CLUSTER_NAME unsafe.topology.cluster.x-k8s.io/disable-update-class-name-check=
    ```
    
2. Label the cluster resources with what the topology controller expects it to be.
   Replace `$CLUSTER_NAME-control-plane` and `$CLUSTER_NAME-md-0` with the names of your control-plane and `MachineDeployment`:

    ```shell
    # label cluster
    kubectl label Cluster/$CLUSTER_NAME topology.cluster.x-k8s.io/owned=
    kubectl label DockerCluster/$CLUSTER_NAME topology.cluster.x-k8s.io/owned=
    
    # label resources based on the cluster label
    kubectl label MachineSet -l cluster.x-k8s.io/cluster-name=$CLUSTER_NAME topology.cluster.x-k8s.io/owned=
    kubectl label DockerMachine -l cluster.x-k8s.io/cluster-name=$CLUSTER_NAME topology.cluster.x-k8s.io/owned=
    kubectl label Machine -l cluster.x-k8s.io/cluster-name=$CLUSTER_NAME topology.cluster.x-k8s.io/owned=
    kubectl label KubeadmConfig -l cluster.x-k8s.io/cluster-name=$CLUSTER_NAME topology.cluster.x-k8s.io/owned=
    
    # label control-plane
    kubectl label DockerMachineTemplate/$CLUSTER_NAME-control-plane topology.cluster.x-k8s.io/owned=
    kubectl label DockerMachineTemplate/$CLUSTER_NAME-control-plane cluster.x-k8s.io/cluster-name=$CLUSTER_NAME
    kubectl label KubeadmControlPlane/$CLUSTER_NAME-control-plane topology.cluster.x-k8s.io/owned=
    
    kubectl label MachineSet -l cluster.x-k8s.io/deployment-name=$CLUSTER_NAME-control-plane topology.cluster.x-k8s.io/deployment-name=$CLUSTER_NAME-control-plane
    kubectl label Machine -l cluster.x-k8s.io/control-plane-name=$CLUSTER_NAME-control-plane topology.cluster.x-k8s.io/deployment-name=$CLUSTER_NAME-control-plane
    kubectl label DockerMachine -l cluster.x-k8s.io/control-plane-name=$CLUSTER_NAME-control-plane topology.cluster.x-k8s.io/deployment-name=$CLUSTER_NAME-control-plane
    
    # label worker nodepool
    kubectl label DockerMachineTemplate/$CLUSTER_NAME-md-0 topology.cluster.x-k8s.io/owned=
    kubectl label DockerMachineTemplate/$CLUSTER_NAME-md-0 cluster.x-k8s.io/cluster-name=$CLUSTER_NAME
    kubectl label DockerMachineTemplate/$CLUSTER_NAME-md-0 topology.cluster.x-k8s.io/deployment-name=$CLUSTER_NAME-md-0
    kubectl label KubeadmConfigTemplate/$CLUSTER_NAME-md-0 topology.cluster.x-k8s.io/owned=
    kubectl label MachineDeployment/$CLUSTER_NAME-md-0 topology.cluster.x-k8s.io/owned=
    kubectl label MachineDeployment/$CLUSTER_NAME-md-0 topology.cluster.x-k8s.io/deployment-name=$CLUSTER_NAME-md-0
    
    kubectl label KubeadmConfig -l cluster.x-k8s.io/deployment-name=$CLUSTER_NAME-md-0 topology.cluster.x-k8s.io/deployment-name=$CLUSTER_NAME-md-0
    kubectl label MachineSet -l cluster.x-k8s.io/deployment-name=$CLUSTER_NAME-md-0 topology.cluster.x-k8s.io/deployment-name=$CLUSTER_NAME-md-0
    kubectl label Machine -l cluster.x-k8s.io/deployment-name=$CLUSTER_NAME-md-0 topology.cluster.x-k8s.io/deployment-name=$CLUSTER_NAME-md-0
    kubectl label DockerMachine -l cluster.x-k8s.io/deployment-name=$CLUSTER_NAME-md-0 topology.cluster.x-k8s.io/deployment-name=$CLUSTER_NAME-md-0
    ```
   
3.  Patch the worker `MachineSet` with new labels. This prevents the topology controller from recreating the existing Machines.
    Replace `$CLUSTER_NAME-md-0` with the name of your `MachineDeployment`:

    ```shell
    cat <<EOF > machineset-patch.json
    {
        "spec": {
            "selector": {
                "matchLabels": {
                    "topology.cluster.x-k8s.io/deployment-name": "$CLUSTER_NAME-md-0",
                    "topology.cluster.x-k8s.io/owned": ""
                }
            },
            "template": {
                "metadata": {
                    "labels": {
                        "topology.cluster.x-k8s.io/deployment-name": "$CLUSTER_NAME-md-0",
                        "topology.cluster.x-k8s.io/owned": ""
                    }
                }
            }
        }
    }
    EOF
    kubectl patch $(kubectl get machineset -l cluster.x-k8s.io/cluster-name=$CLUSTER_NAME -o name) --type merge --patch-file machineset-patch.json
    ```

### Set Topology values for the Cluster

1.  Create a Cluster patch file, setting the `replicas` and the `version` to your cluster's current Kubernetes version:

    ```shell
    cat <<EOF > cluster-patch.json
    {
        "spec": {
            "topology": {
                "class": "$CLUSTER_NAME",
                "controlPlane": {
                    "metadata": {},
                    "replicas": 1
                },
                "version": "$KUBERNETES_VERSION",
                "workers": {
                    "machineDeployments": [{
                        "class": "$CLUSTER_NAME-md-0",
                        "name": "$CLUSTER_NAME-md-0",
                        "replicas": 1
                    }]
                }
            }
        }
    }
    EOF
    ```

2.  Patch the Cluster with `spec.topology`:

    ```shell
    kubectl patch cluster $CLUSTER_NAME --type merge --patch-file cluster-patch.json
    ```
    
## Verify the Cluster was Adopted

1.  Check the state of overall state of the cluster:

    ```shell
    $ clusterctl describe cluster $CLUSTER_NAME
    NAME                                                                  READY  SEVERITY  REASON  SINCE  MESSAGE
    Cluster/cc-migration-demo                                             True                     8m33s
    ├─ClusterInfrastructure - DockerCluster/cc-migration-demo             True                     10m
    ├─ControlPlane - KubeadmControlPlane/cc-migration-demo-control-plane  True                     8m33s
    │ └─Machine/cc-migration-demo-control-plane-knkrs                     True                     8m35s
    └─Workers
      └─MachineDeployment/cc-migration-demo-md-0                          True                     7m40s
        └─Machine/cc-migration-demo-md-0-7cdf54cd4d-bnqzg                 True                     8m17s
    ```

2.  Verify the Machines were not recreated:

    ```shell
    $ kubectl get machines -l cluster.x-k8s.io/cluster-name=$CLUSTER_NAME
    NAME                                      CLUSTER             NODENAME                                  PROVIDERID                                           PHASE     AGE   VERSION
    cc-migration-demo-control-plane-knkrs     cc-migration-demo   cc-migration-demo-control-plane-knkrs     docker:////cc-migration-demo-control-plane-knkrs     Running   10m   v1.25.3
    cc-migration-demo-md-0-7cdf54cd4d-bnqzg   cc-migration-demo   cc-migration-demo-md-0-7cdf54cd4d-bnqzg   docker:////cc-migration-demo-md-0-7cdf54cd4d-bnqzg   Running   10m   v1.25.3
    ```

3.  Finally, update the Kubernetes version by changing a single value in the Cluster:

    ```shell
    $ kubectl patch cluster $CLUSTER_NAME --type merge --patch '{"spec":{"topology":{"version":"v1.26.0"}}}'
    ```
    
After a few minutes you should see new `Machines` and updated `Nodes`. At this point, your Cluster is being managed by the `ClusterClass`!
