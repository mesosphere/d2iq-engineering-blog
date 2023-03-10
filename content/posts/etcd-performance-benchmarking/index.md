---
authors: ["azhovan"]
title: "Etcd Performance Benchmarking"
date: 2023-03-10T17:13:12+01:00
featured: false
tags: ["d2iq", "etcd", "kubernetes"]
excerpt: make sure your etcd server running on reliable storage
feature_image: feature.png
---


# Is your etcd fast enough?

It is very likely when you are going to install your kubernetes management platform of choice you'll get a hardware recommendation, similar to what [we recommend to you in D2iQ](https://docs.d2iq.com/dkp/2.4/resource-requirements).

Although these hardware recommendations are great to help you, they never go beyond capacity, for example it might be suggested to use 2 cores cpu and 2GB of RAM but you'll never know how fast the CPU should be or etc. One reason might be because modern hardwares is good enough in terms of performance or we just can trust the provider and select its recommendation (i.e [aws recommendations](https://aws.amazon.com/intel/#Instance_Types)).

Most likely when you're reading this article you've already have your cluster up and running so we don't explore options that should be considered before choosing your hardwares, but rather make sure your existing ones perform at expected level. In perticular our focus is storage. You may have different stateful applications like mysql, etc, those are also beyond the scope of this article as our focus is mainly on kubernetes itself.

## etcd
[etcd](https://github.com/etcd-io/etcd)(pronounced et-see-dee) is the primary datastore of Kubernetes. It is a critical component that stores all kubernetes resources in a cluster and it is very important that etcd operations are performed at an ideal speed. Having an etcd with poor performance is a clear indicator that your customer's experience has been impacted significantly.

If you see following logs in your etcd server, it is important to not ignore them

>  etcdserver: read-only range request … took too long (xxxx) to execute


This is an indicator that etcd is not performing well and based on [official documentation](https://etcd.io/docs/v3.3/faq/#what-does-the-etcd-warning-apply-entries-took-too-long-mean) this is usually caused by:

- Contention between etcd and other apps
- Disk is slow
- CPU starvation

If you have monitoring system enabled in your cluster, etcd reports some **metrics** to [prometheus](https://prometheus.io/) that can help you to distinguish between these cases:

- **wal\_fsync\_duration\_seconds**
- **backend\_commit\_duration\_seconds**

First one is called before applying changes to disk, and second one is after applying changes to disk. it doesn't matter which one you choose, just keep in mind high values for these metrics mean high disk operation latencies and indicate disk issues.

As [etcd doc suggests](https://etcd.io/docs/v3.3/faq/#what-does-the-etcd-warning-apply-entries-took-too-long-mean) that 99th percentile of these metrics should be less than **25 ms** for storage in order to be considered fast enough.

If you're running etcd on Linux machines another way to benchmark your storage performance is to use [Fio](https://github.com/axboe/fio) which is a very popular package to simulate I/O workload.

**Step 1: Install required packages**

```bash 
apt install -y gcc zlib1g-dev make git  
```

**Step 2: Clone the fio repo and install it**
```bash 
git clone git://git.kernel.dk/fio.git && cd fio
./configure
make 
make install   
  ```

**Step3: Configure fio**

`test-dir` is a directory under the storage device you want to test

 ```bash 
export PATH=/usr/local/bin:$PATH  
fio --rw=write --ioengine=sync --fdatasync=1 --directory=test-dir --size=22m --bs=2300 --name=mytest  
  ```
following is the output from etc node of D2iQ cluster running on an AWS ec2 instance type of `m5.xlarge`. check the 99th percentile of `fdatasync`

 ```bash 
 fsync/fdatasync/sync_file_range:
   sync (usec): min=534, max=15766, avg=1273.08, stdev=1084.70
   sync percentiles (usec):
   |...,
   | 99.00th=[ 6376], 99.50th=[ 9634], 99.90th=[15795], 99.95th=[15795],
``` 

you can see that the 99th percentile is 6376 or about 6.3ms of latency which is an acceptable latency.