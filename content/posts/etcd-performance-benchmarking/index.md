---
authors: ["azhovan"]
title: "Etcd Performance Benchmarking"
date: 2023-03-10T17:13:12+01:00
featured: false
tags: ["d2iq", "etcd", "kubernetes"]
excerpt: Ensure your etcd server is running on reliable storage
feature_image: feature.png
---


# Is your etcd fast enough?

When you install the Kubernetes management platform of your choice, there are certain minimal hardware requirements you need to meet. At D2iQ, for example, we have [these requirements](https://docs.d2iq.com/dkp/2.4/resource-requirements).

These hardware recommendations provide a great help and starting point, but they don’t tell you anything about the actual performance of your hardware. We never seem to question the hardware’s performance. Possibly because we trust modern hardware to perform well enough, or trust the cloud provider and follow their recommendations (for an example, see [aws recommendations](https://aws.amazon.com/intel/#Instance_Types)).

However, the actual performance might differ depending on the CPU's brand, frequency, and other specifications. For example, if a platform provider suggests setting up two CPU cores and two GB of RAM, those exactly same resources could perform differently depending on the CPU brand and type.

Most likely, as you are reading this article, you already have your cluster up and running. So you are not really exploring other hardware options, but you rather want to ensure that your existing hardware is performing at the expected level. In this particular article, our focus is storage in the context of **Kubernetes** itself. You may have different stateful applications like MySQL, but those are beyond the scope of this article.

## etcd

[etcd](https://github.com/etcd-io/etcd)(pronounced et-see-dee) is the primary datastore of Kubernetes. It is a critical component that stores all Kubernetes resources in a cluster, therefore it is very important that etcd operations are performed at an ideal speed. Having an etcd instance with poor performance is a clear indicator that your customer's experience is significantly being impacted.

If you see the following or similar messages in your etcd server logs, it is important that you do not ignore them:

>  etcdserver: read-only range request … took too long (xxxx) to execute


Such messages are indicators that etcd is not performing well and based on [etcd’s official documentation](https://etcd.io/docs/v3.3/faq/#what-does-the-etcd-warning-apply-entries-took-too-long-mean), this is usually caused by:

- Contention between etcd and other apps
- Slow disk
- CPU starvation

## Benchmarking via etcd metrics

For real time monitoring and debugging, you can use etcd metrics. etcd [reports](https://etcd.io/docs/v3.4/metrics/) some **metrics** to [Prometheus](https://prometheus.io/) that can help you distinguish between the previous cases:

- **wal\_fsync\_duration\_seconds**
- **backend\_commit\_duration\_seconds**

The first metric is reported before applying changes to a disk, and the second one is reported after applying changes to a disk. It does not matter which one you choose, just keep in mind that high values for these metrics mean high disk operation latencies and disk issues.  
As the [etcd documentation suggests](https://etcd.io/docs/v3.3/faq/#what-does-the-etcd-warning-apply-entries-took-too-long-mean), the 99th percentile duration should be less than **25 ms** for storage to be considered fast enough.

## Benchmarking via Fio

If you are running etcd on Linux machines, another way to benchmark your storage performance is to use [Fio](https://github.com/axboe/fio), a very popular package to simulate I/O workload.

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
The following output is an example from an etcd node of a D2iQ cluster running on an AWS ec2 instance of type `m5.xlarge`. Check the 99th percentile of `fdatasync`!

 ```bash 
 fsync/fdatasync/sync_file_range:
   sync (usec): min=534, max=15766, avg=1273.08, stdev=1084.70
   sync percentiles (usec):
   |...,
   | 99.00th=[ 6376], 99.50th=[ 9634], 99.90th=[15795], 99.95th=[15795],
``` 

You can see that the 99th percentile is 6376 or about 6.3ms of latency, which is an acceptable latency.