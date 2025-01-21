---
title: "Installing Rook Ceph Cluster using PVC Storage on KinD (Kubernetes in Docker) clusters"
date: 2022-09-26T16:50:39+01:00
authors: ["takirala"]
featured: true
tags: ["Kubernetes", "kind", "storage", "local", "ceph"]
slug: rook-ceph-on-kind-clusters
feature_image: todo.jpg
excerpt: |
  This blog post highlights how to install Rook Ceph on `kind` clusters by provisioning PVCs of type block storage on `kind` clusters which is something that is not supported out-of-the-box. This setup is meant only for local development and CI environments.
---

## Introduction

[Rook](https://github.com/rook/rook) operator makes it easy to install [Ceph](https://github.com/ceph/ceph) on kubernetes clusters. It provides an helm chart to be easily able to deploy multiple ceph clusters to your cluster, all managed by a single operator. When I first tried to install Ceph, I wanted to try it on my local [`kind`](https://github.com/kubernetes-sigs/kind) cluster.

Rook Ceph supports a varied sets of functionality and in the scope of the post, I will mainly talk about how to setup an S3 compatible storage using Rook Ceph on a kind cluster with the most minimalistic configuration. This is **NOT** meant for production deployments.

### Rook Ceph Configuration

Rook ceph supports creating `CephCluster` backed by either [Host Storage](https://www.rook.io/docs/rook/v1.10/CRDs/Cluster/host-cluster/) option or [PVC Storage](https://www.rook.io/docs/rook/v1.10/CRDs/Cluster/pvc-cluster/) option amongst other configuration options. In the scope of this guide, we aim to install Ceph using PVC Storage option. This configuration gives more flexiblity in terms of having more than one CephCluster or make your configuration agnostic to your cluster environment (e.g.: `kind`, baremetal or cloud).

### Background

In order to create a `CephCluster` with PVC Storage Option, I need to be able to satisfy Persistent Volume Claims with `volumeMode: Block`. A `CephCluster` primarily deploys two components that require PVCs to be fulfilled: `Monitors`<sup>[1](https://rook.io/docs/rook/v1.10/CRDs/Cluster/ceph-cluster-crd/#mon-settings)</sup> and `Object Storage Daemons` <sup>[2](https://rook.io/docs/rook/v1.10/CRDs/Cluster/ceph-cluster-crd/#osd-configuration-settings)</sup>. The first one can use either `volumeMode: FileSystem` or `volumeMode: Block` whereas OSDs can only use `volumeMode: Block` type storage. So I decided to use `FileSystem` storage for the monitor and `Block` storage for the object storage daemon in this guide.

A `kind` cluster does not ship with a Block storage out-of-box. Almost all the cloud native platforms out there ship a default Block Storage provisioner ([Also refer to default cloud provisioners in DKP](https://docs.d2iq.com/dkp/latest/default-storage-providers-in-dkp)). However, a simple `kind` cluster does not have this luxury. I started by [creating loopback storage on my `kind` cluster](../block-storage-on-kind/) and use [sig-storage-local-static-provisioner](https://github.com/kubernetes-sigs/sig-storage-local-static-provisioner) to provision `PersistentVolume`s which did work create PersistentVolumes but loopback devices are not supported by rook discovery<sup>[3](https://github.com/rook/rook/blob/v1.10.2/pkg/clusterd/disk.go#L37-L44)[4](https://github.com/rook/rook/issues/7206)</sup>. Trying to use a loopback storage will result in an error like:

```bash
2022-09-25 01:13:59.024242 I | cephosd: discovering hardware
2022-09-25 01:13:59.024248 D | exec: Running command: lsblk /mnt/rook-ceph-osd-set1-data-0dzcnk --bytes --nodeps --pairs --paths --output SIZE,ROTA,RO,TYPE,PKNAME,NAME,KNAME,MOUNTPOINT,FSTYPE
2022-09-25 01:13:59.025845 D | sys: lsblk output: "SIZE=\"1073741824\" ROTA=\"0\" RO=\"0\" TYPE=\"loop\" PKNAME=\"\" NAME=\"/dev/loop352\" KNAME=\"/dev/loop352\" MOUNTPOINT=\"\" FSTYPE=\"\""
2022-09-25 01:13:59.028425 C | rookcmd: failed to get device info for "/mnt/rook-ceph-osd-set1-data-0dzcnk": unsupported diskType loop
```

If using minikube, this is possible to achieve<sup>[6](https://github.com/rook/rook/issues/7206#issuecomment-934503848)</sup> but I did not want to use an hypervisor based solution for my usecase. I really wanted to make this possible on a `kind` cluster. Also, more recently, `ceph` started [supporting loopback storage](https://github.com/ceph/ceph/pull/46375), but this is unreleased as of writing this post and is yet to be supported in rook.

As the next best option, I tried to create `lvm`<sup>[5](https://www.redhat.com/sysadmin/create-volume-group)</sup> type disk as that is supported<sup>[3](https://github.com/rook/rook/blob/v1.10.2/pkg/clusterd/disk.go#L37-L44)</sup>. As I do not want to use an extra physical disk (remember, this guide's sole purpose to get this working in my CI enviroment where things need to happen blazingly fast!), I started to look into using loopback storage to create `lvm`s as it is the easiest way to provision storage without using any external disks. There is a [known issue](https://rook.io/docs/rook/v1.10/Troubleshooting/ceph-common-issues/#lvm-metadata-can-be-corrupted-with-osd-on-lv-backed-pvc) with using LV-backed PVC but my usecase can tolerate this as the cluster is short lived.

### Logical Volumes based on loopback devices

For the scope of this guide, I assumed a single node `kind` cluster but the scripts in this guide can easily be modified to support a multi node `kind` cluster. Also, I used the [`mesosphere/kind-node`](https://hub.docker.com/r/mesosphere/kind-node) docker image as it comes built in with `lvm2` package installed. This is needed to provision logical volumes on `kind` nodes.

1. Create a `kind` cluster:

    ```bash

    kind create cluster --name ceph-test --image mesosphere/kind-node:v1.25.2
    ```

2. Use `docker exec` (or use whatever container runtime you have available) to shell into the running container and create the loopback device as well as a virtual group and logical volume on top of it:

    ```bash
    docker exec -it ceph-test-control-plane bash
    ```

    After `exec`ing into the container, run the following commands in the container.

    Create a loopback storage device:
    ```bash
    NODENAME=$(cat /etc/hostname)
    UNIQUEID=$((73 + ${#NODENAME}))
    export LOOPBACK_DEVICE=/dev/loop${UNIQUEID}
    mknod "${LOOPBACK_DEVICE}" b 7 "${UNIQUEID}"
    ```

    Bind the loopback device with storage of desired capacity. In this case, we are initializing 2G with a block size of 1M.
    ```bash
    mkdir -p /hack
    # Initialize a 2G file
    dd if=/dev/zero of="/hack/file-vol${UNIQUEID}" bs=1M count=2048
    # Bind the storage
    losetup "${LOOPBACK_DEVICE}" "/hack/file-vol${UNIQUEID}"
    ```

    Initialize a physical volume based on this loopback storage:
    ```bash
    echo "Initialize a physical volume for LVM backed by loopback device"
    pvcreate -ff "${LOOPBACK_DEVICE}"
    ```

    Now, decide upon the naming convention for the logical volumes that will be created. I used:
    ```bash
    # Volume group name
    export VG_NAME="cephvg$UNIQUEID"
    # Logical volume name
    export LV_NAME="cephlv$UNIQUEID"
    ```

    Create a volume group (uniqueness is guaranteed by hostname):
    ```bash
    # Create a volume group"
    vgcreate "${VG_NAME}" "${LOOPBACK_DEVICE}"
    ```

    Create a logical volume (uniqueness is guaranteed by hostname). Note that this logical volume consumes only 1G out of 2G capacity of Physcial volume created above. We can increase/decrease this based on ceph configuration:
    ```bash
    # Create a logical volume"
    lvcreate --zero n --size 1G --name "${LV_NAME}" "${VG_NAME}"
    ```

    Activate the volume group and ensure rook discovery can see it (check using `lsblk` output)
    ```bash
    # Activate volume group
    vgchange -a y "${VG_NAME}"

    # Create the special files for volume group
    vgmknodes --refresh "${VG_NAME}"

    # Ensure rook discovery can see the lvm entries via lsblk output
    lsblk "/dev/${VG_NAME}/${LV_NAME}" --bytes --nodeps --pairs --paths --output SIZE,ROTA,RO,TYPE,PKNAME,NAME,KNAME,MOUNTPOINT,FSTYPE
    ```

### Create `PersistentVolume`s pointing to Logical Volumes

Now that you have a logical volume on the kind, its time to create a PersistenVolume pointing to it. Note this approach uses a manual provisioning mechanism, but we can deploy [sig-storage-local-static-provisioner](https://github.com/kubernetes-sigs/sig-storage-local-static-provisioner) to make this more dynamic. As this is for a short lived cluster, I did not deploy it. See the blog post about [block storage on kind](../block-storage-on-kind/) to see how to leverage the static local provisioner. Deploy the following daemonset to simply deploy one PersistentVolume per each kind node:

```yaml
cat <<EOF | kubectl apply -f -
---
kind: StorageClass
apiVersion: storage.k8s.io/v1
metadata:
name: manual
provisioner: kubernetes.io/no-provisioner
volumeBindingMode: WaitForFirstConsumer
---
apiVersion: v1
kind: ServiceAccount
metadata:
name: create-pv-from-lvm
namespace: default
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
name: create-pv-from-lvm
namespace: default
roleRef:
apiGroup: rbac.authorization.k8s.io
kind: ClusterRole
name: cluster-admin
subjects:
- kind: ServiceAccount
    name: create-pv-from-lvm
    namespace: default
---
# A daemonset to create PVs from each kind node acc. to the /dev/VolumeGroup<>/LogicalVolume<> convention
# This uses downward API to get the nodename and then searches for the that specific VG/LV.
apiVersion: apps/v1
kind: DaemonSet
metadata:
name: create-pv-from-lvm
namespace: default
labels:
    app: create-pv-from-lvm
spec:
selector:
    matchLabels:
    name: create-pv-from-lvm
template:
    metadata:
    labels:
        name: create-pv-from-lvm
    spec:
    tolerations:
        - operator: Exists
        effect: NoSchedule
    serviceAccountName: create-pv-from-lvm
    containers:
        - name: pv-from-lvm
        image: bitnami/kubectl:1.23.6
        command:
            - /bin/bash
            - -c
            - |
            # NODE_NAME is usually ${DEV_CLUSTER_NAME}-control-plane or ${DEV_CLUSTER_NAME}-worker but it doesn't matter for the scope of this script.
            UNIQUEID=$((73 + ${#NODE_NAME}))
            readonly VG_NAME="cephvg${UNIQUEID}"
            readonly LV_NAME="cephlv${UNIQUEID}"
            echo "NODE_NAME is ${NODE_NAME} VG_NAME is ${VG_NAME} LV_NAME is ${LV_NAME}"
            cat << EOF | kubectl apply -f -
            apiVersion: v1
            kind: PersistentVolume
            metadata:
                # PVs are cluster scoped, so keep the name unique.
                # Since we create 1 PV per 1 Node, we can use Node name to keep naming unique.
                name: pv-manual-${NODE_NAME}
            spec:
                storageClassName: manual
                capacity:
                storage: 1Gi
                accessModes:
                - ReadWriteOnce
                persistentVolumeReclaimPolicy: Retain
                volumeMode: Block
                local:
                path: /dev/${VG_NAME}/${LV_NAME}
                nodeAffinity:
                required:
                    nodeSelectorTerms:
                    - matchExpressions:
                        - key: kubernetes.io/hostname
                            operator: In
                            values:
                            - ${NODE_NAME}
            EOF
            sleep 100000000 # This is alternative of feature request https://github.com/kubernetes/kubernetes/issues/36601
        env:
            - name: NODE_NAME
            valueFrom:
                fieldRef:
                fieldPath: spec.nodeName
EOF
```

After which you should be able to see the `PersistentVolume`s become `Available`:

```bash
TODO
```

### Deploying Rook Ceph and Rook Ceph Cluster

Since a `kind` cluster can have multiple nodes, I wanted to build a script that can create volumes on each node in a generic manner. I used the hostname in `/etc/hostname` as the unique identifier.


References

- [1] https://rook.io/docs/rook/v1.10/CRDs/Cluster/ceph-cluster-crd/#mon-settings
- [2] https://rook.io/docs/rook/v1.10/CRDs/Cluster/ceph-cluster-crd/#osd-configuration-settings
- [3] https://github.com/rook/rook/blob/v1.10.2/pkg/clusterd/disk.go#L37-L44
- [4] https://github.com/rook/rook/issues/7206
- [5] https://www.redhat.com/sysadmin/create-volume-group
- [6] https://github.com/rook/rook/issues/7206#issuecomment-934503848
- [5] https://www.rook.io/docs/rook/v1.10/CRDs/Cluster/host-cluster/
- [6] https://www.rook.io/docs/rook/v1.10/CRDs/Cluster/pvc-cluster/