---
title: "Provisioning Block Storage on KinD (Kubernetes in Docker) clusters"
date: 2022-09-26T16:50:39+01:00
authors: ["takirala"]
featured: true
tags: ["Kubernetes", "KinD", "storage", "local"]
slug: block-storage-on-kind-clusters
feature_image: todo.jpg
excerpt: |
  Explore how to create `Block` storage on `kind` clusters.
---

Whenever playing with a new application, running it locally is easier, faster, and cheaper. However, as storage becomes cheaper day by day, it is becoming incredibly prevalent to have external storage as a requirement for most applications even with a minimalistic configuration. `kind`, which is a kubernetes sigs project is almost defacto standard for running kubernetes clusters locally. Lots of projects, including kubernetes itself uses kind to (See [kubernetes/test-infra](https://github.com/kubernetes/test-infra)) run kubernetes clusters in CI. In this guide, we explore how to create `Block` storage on `kind` clusters as it is not supported out of the box.


# Catchy title

We use kind in our CI to run various integration tests (and some in air-gapped connectivity) installing multiple compnents on a kind cluster. Recently, I had a requirement to provision Block storage on my kind cluster and in this blog post I am going to articulate how I was able to provision Block storage for my kind cluster in a CI environment with no external storage.

## Prerequisites

This post is a hands-on guide and assumes you have familiarity with:
- `kind`
- `helm`

## Creating a kind Cluster

`kind` has a quick start guide that does a very good job of documenting all the possible configurations of creating a `kind` cluster. Creating a cluster is as simple as doing

```bash
kind create cluster
```

which creates a single node cluster.

## Creating loopback devices for storage

### Create a device node

`mknod` is used to create a device node on a filesystem. Usually, superuser privileges are required to execute the following command:

```bash
mknod /dev/loop-mine42 b 7 42
```

where :
- `/dev/loop-mine42` is the path of the loopback storage
- `b` stands for `block` storage
- `7` is the major ID number which identifies the general class of device, and is used by kernel to look up the appropriate driver for this type of device. In this case, it indicates `block` type <sup>[1](https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git/tree/Documentation/admin-guide/devices.txt)</sup>. for more device types.
- `42` is the minor ID number and it uniquely identifies a particular device within a general class. You can choose any value between 0 to 255 (Most systems may support higher value, but, for historical reasons, they are sometimes stored in a single byte so its safest to pick a value less than 255).

### Initialize device node with block storage of desired capacity

The easiest way to configure capacity on a block devices is to create a normal file, and have it then mapped to a block device. We can use `dd` to create a 1G file with zeros and map it to the block device created above at `/dev/loop-mine42`.

```bash
rm -rf /hack && mkdir /hack
dd if=/dev/zero of=/hack/file-mine42 bs=1M count=1024
```

Once that is in place, we can use `losetup` to setup the mapping of loopback device with the file:

```bash
losetup /dev/loop-mine42 "/hack/file-mine42"
```

after which you should be able to see the loopback device using simply `ls -l` or even `lsblk`:

```bash
ls -l /dev/loop-mine42
brw-r--r-- 1 root root 7, 44 Sep 30 06:16 /dev/loop-mine42
```

Note the permissions string that start with `b` which means its a block device.

### Deploying the static local provisioner with block storage provisioning

Clone the static local provisioner repository locally:

```
git clone --depth 1 --branch v2.5.0 https://github.com/kubernetes-sigs/sig-storage-local-static-provisioner.git
cd sig-storage-local-static-provisioner
```

Create the following `values.yaml` 

```yaml
cat <<EOF >>values.yaml
classes:
- name: loopback-block-storage # Defines name of storage classe.
  # Path on the host where local volumes of this storage class are mounted
  # under.
  hostDir: /dev
  # Optionally specify mount path of local volumes. By default, we use same
  # path as hostDir in container.
  # mountDir: /mnt/fast-disks
  # The volume mode of created PersistentVolume object. Default to Filesystem
  # if not specified.
  volumeMode: Block
  # File name pattern to discover. By default, discover all file names.
  namePattern: "loop-mine*"
  blockCleanerCommand:
  #  Do a quick reset of the block device during its cleanup.
  - "/scripts/quick_reset.sh"
  #  or use dd to zero out block dev in two iterations by uncommenting these lines
  #  - "/scripts/dd_zero.sh"
  #  - "2"
  # or run shred utility for 2 iteration.s
  #  - "/scripts/shred.sh"
  #  - "2"
  # or blkdiscard utility by uncommenting the line below.
  #  - "/scripts/blkdiscard.sh"
  # Uncomment to create storage class object with default configuration.
  # storageClass: true
  # Uncomment to create storage class object and configure it.
  storageClass:
    reclaimPolicy: Delete # Available reclaim policies: Delete/Retain, defaults: Delete.
    # isDefaultClass: true # set as default class
common:
  mountDevVolume: false
EOF
```

Note that we set `common.mountDevVolume` to false because we are mounting our loopback devices under `/dev` with `loopback-block-storage` storage class. Finally, create and deploy the provisioner:

```bash
helm template ./helm/provisioner --values values.yaml > deployment/kubernetes/provisioner_generated.yaml
kubectl create -f deployment/kubernetes/provisioner_generated.yaml
```

After which you should be able to see provisioner provision PersistentVolumes by running `kubectl get pv`:

```
kubectl get pv
NAME                CAPACITY   ACCESS MODES   RECLAIM POLICY   STATUS      CLAIM   STORAGECLASS             REASON   AGE
local-pv-67fa9e81   1Gi        RWO            Delete           Available           loopback-block-storage            2m51s
```

Now, your application can create `PersitentVolumeClaim`s with `volumeMode: Block` and they will be `Bound` to `PersistentVolume`s created above:

```yaml
kind: PersistentVolumeClaim
apiVersion: v1
metadata:
  name: example-local-claim
spec:
  accessModes:
  - ReadWriteOnce
  resources:
    requests:
      storage: 1Gi
  volumeMode: Block
  storageClassName: loopback-block-storage
```

## Block storage created on host and then mounted in to `kind` node via loopback storage

To summarize all of above into a neat bash script:

```bash
# Create a KinD Cluster
kind create cluster

# Create a regular file of desired capacity for loopback storage
rm -rf /hack && mkdir /hack
dd if=/dev/zero of=/hack/file-mine42 bs=1M count=1024

# Create loopback device that maps to file created above
mknod /dev/loop-mine42 b 7 42
losetup /dev/loop-mine42 "/hack/file-mine42"

# Deploy local storage provisioner
git clone --depth 1 --branch v2.5.0 https://github.com/kubernetes-sigs/sig-storage-local-static-provisioner.git
cd sig-storage-local-static-provisioner

# Create a values.yaml to generate Provisioner template
cat <<EOF >>values.yaml
# See https://github.com/kubernetes-sigs/sig-storage-local-static-provisioner/blob/v2.5.0/helm/provisioner/values.yaml for more configuration options.
classes:
- name: loopback-block-storage # Defines name of storage classe.
  hostDir: /dev
  volumeMode: Block
  namePattern: "loop-mine*"
  blockCleanerCommand:
  - "/scripts/quick_reset.sh"
  storageClass:
    reclaimPolicy: Delete
common:
  mountDevVolume: false
EOF

# Use helm templating to create provisioner template
helm template ./helm/provisioner --values values.yaml > deployment/kubernetes/provisioner_generated.yaml

# Create provisioner
kubectl create -f deployment/kubernetes/provisioner_generated.yaml
```

In a subsequent post, I will explore how we can use Linux Logical Volume Management (LVM) to provision `Block` storage based on top of loopback storage. Certain services, like `rook-ceph` does not support using `Block` storage from `loopback` devices and in these cases, we have to resort to other options<sup>[2](https://github.com/rook/rook/blob/v1.10.2/pkg/clusterd/disk.go#L37-L44)</sup>.

References
- [1] https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git/tree/Documentation/admin-guide/devices.txt
- [2] https://github.com/rook/rook/blob/v1.10.2/pkg/clusterd/disk.go#L37-L44
