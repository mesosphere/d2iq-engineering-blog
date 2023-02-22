---
authors: ["jdyson"]
title: "A Tale of Two Container Image Tools: Skopeo and Crane"
date: 2023-01-12T12:15:21Z
featured: false
tags: ["oci", "mages", "tools"]
excerpt: |
  Working with container images is pretty much a fact of life in modern day infrastructure, especially with Kubernetes. Make your life easier by using tools such as skopeo and crane.
feature_image: feature.png
---

All software that you deploy on [Kubernetes](https://k8s.io/) requires packaging as container images. There are many tools to build container images (e.g. [Docker](https://www.docker.com/), [buildah](https://buildah.io/), etc). Once the images are built, they are pushed to an image registry, and referenced in [pod](https://kubernetes.io/docs/concepts/workloads/pods/) descriptors (generally inside higher level abstractions such as [`Deployments`](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/), [`Daemonsets`](https://kubernetes.io/docs/concepts/workloads/controllers/daemonset/), [`StatefulSets`](https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/), etc) which describe how to launch the software you want to run. The kubelet launches your pods and containers via the container runtime interface (CRI), which pulls the container images from the relevant registry, configures the pods and containers as requested, and starts them running.

## What is a container image?

A container image is a self-contained, executable bundle that contains everything required to run a piece of software in a well-defined runtime environment. The bundle contains one or more tar archives, plus a JSON manifest file that describes the software contained in the bundle and how to run it (e.g. what command to run to start the software).

Let's jump straight in using one of the tools we're going to talk about, `crane`, and see what an image looks like by inspecting the manifest directly from a registry:

```shell
$ crane manifest busybox:1.36 --platform linux/amd64
{
   "schemaVersion": 2,
   "mediaType": "application/vnd.docker.distribution.manifest.v2+json",
   "config": {
      "mediaType": "application/vnd.docker.container.image.v1+json",
      "size": 1457,
      "digest": "sha256:66ba00ad3de8677a3fa4bc4ea0fc46ebca0f14db46ca365e7f60833068dd0148"
   },
   "layers": [
      {
         "mediaType": "application/vnd.docker.image.rootfs.diff.tar.gzip",
         "size": 2592863,
         "digest": "sha256:205dae5015e78dd8c4d302e3db4eb31576fac715b46d099fe09680ba28093a7a"
      }
   ]
}
```

Note that neither `crane` or `skopeo` require a running container runtime - they interact with registries via the well-defined APIs (see [OCI Distribution Spec](https://github.com/opencontainers/distribution-spec/blob/v1.0.1/spec.md) for more details).

If we look at the manifest above, we see the following fields:

* `mediaType` This tells the container runtime the format of this manifest. In this case (and still used by the majority of images at this time), this is `application/vnd.docker.distribution.manifest.v2+json`, which means it represents [Docker Image Manifest V2](https://docs.docker.com/registry/spec/manifest-v2-2/). Note that an equivalent [OCI](https://opencontainers.org/) spec exists and would use the media type of `application/vnd.oci.image.manifest.v1+json`.
* `config` This holds a reference to the config layer of the image (we'll look at that below).
* `layers` This holds references to the tarballs that make up the container filesystem. Container filesystems are constructed from layered tarballs. If you're familiar with `Dockerfile` used for building images, each instruction in the `Dockerfile` produces a new layer containing only the changed files from the layer below. In this case, the image only has a single layer, but it is very common for images to contain many layers.

Let's take a look at the config layer of the image:

```shell
$ crane config busybox:1.36.0 # Can also do crane blob busybox:1.36@sha256:66ba00ad3de8677a3fa4bc4ea0fc46ebca0f14db46ca365e7f60833068dd0148
{
  "architecture": "amd64",
  "config": {
    "AttachStderr": false,
    "AttachStdin": false,
    "AttachStdout": false,
    "Cmd": [
      "sh"
    ],
    "Domainname": "",
    "Entrypoint": null,
    "Env": [
      "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
    ],
    "Hostname": "",
    "Image": "sha256:e9475e3c9e6925b85a80e5db1014a7feb80c0227827c6422eecbd3af8d10519b",
    "Labels": null,
    "OnBuild": null,
    "OpenStdin": false,
    "StdinOnce": false,
    "Tty": false,
    "User": "",
    "Volumes": null,
    "WorkingDir": ""
  },
  "container": "78be87834474355cd7b8fdd93165ac5c46bb9dd2ff6c213c742e7107e266e56f",
  "container_config": {
    "AttachStderr": false,
    "AttachStdin": false,
    "AttachStdout": false,
    "Cmd": [
      "/bin/sh",
      "-c",
      "#(nop) ",
      "CMD [\"sh\"]"
    ],
    "Domainname": "",
    "Entrypoint": null,
    "Env": [
      "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
    ],
    "Hostname": "78be87834474",
    "Image": "sha256:e9475e3c9e6925b85a80e5db1014a7feb80c0227827c6422eecbd3af8d10519b",
    "Labels": {},
    "OnBuild": null,
    "OpenStdin": false,
    "StdinOnce": false,
    "Tty": false,
    "User": "",
    "Volumes": null,
    "WorkingDir": ""
  },
  "created": "2023-01-04T01:19:41.713369468Z",
  "docker_version": "20.10.12",
  "history": [
    {
      "created": "2023-01-04T01:19:41.612792834Z",
      "created_by": "/bin/sh -c #(nop) ADD file:4bd5aa84616ee938414b5300d3ab0ef716638c37d76109bd2ed0ae6cc08fe88a in / "
    },
    {
      "created": "2023-01-04T01:19:41.713369468Z",
      "created_by": "/bin/sh -c #(nop)  CMD [\"sh\"]",
      "empty_layer": true
    }
  ],
  "os": "linux",
  "rootfs": {
    "diff_ids": [
      "sha256:b64792c17e4ad443d16b218afb3a8f5d03ca0f4ec49b11c1a7aebe17f6c3c1d2"
    ],
    "type": "layers"
  }
}
```

This contains all the details describing how to run a container from this image. Notably:

* `os` and `arch` What OS and architecture this image is built for
* `config` Details how to run a container from this image, specifically see `Entrypoint` and `Cmd` which detail the default command(s) to execute when running a container from this image.

And let's look at the layer that was referenced in the manifest above:

```shell
$ crane blob busybox:1.36@sha256:205dae5015e78dd8c4d302e3db4eb31576fac715b46d099fe09680ba28093a7a | tail -10
drwx------ 0/0               0 2023-01-03 22:44 root/
drwxrwxrwt 0/0               0 2023-01-03 22:44 tmp/
drwxr-xr-x 0/0               0 2023-01-03 22:44 usr/
drwxr-xr-x 0/0               0 2023-01-03 22:44 usr/bin/
lrwxrwxrwx 0/0               0 2023-01-03 22:44 usr/bin/env -> ../../bin/env
drwxr-xr-x 1/1               0 2023-01-03 22:44 usr/sbin/
drwxr-xr-x 0/0               0 2023-01-03 22:44 var/
drwxr-xr-x 0/0               0 2023-01-03 22:44 var/spool/
drwxr-xr-x 8/8               0 2023-01-03 22:44 var/spool/mail/
drwxr-xr-x 0/0               0 2023-01-03 22:44 var/www/
```

The output of the command above just shows the last few lines, but from that you can see that the referenced layer is literally just a gzipped tarball of a filesystem. Super simple!

We've just used one of the tools, `crane`, to inspect images directly from the registry with no container runtime locally!

## Cookbook

Let's now show some of the operations that both `skopeo` and `crane` support when using the tools as CLIs.

### Moving images between registries

It is very common to move images between registries, whether that is because your clusters are running in air-gapped (i.e. disconnected) environments, to promote images between dev/test/staging/production registries, etc. If you're using an OCI registry such as [Harbor](https://goharbor.io/) then you can do this via [replication](https://goharbor.io/docs/2.7.0/administration/configuring-replication/), but if not, or if you just want to ad-hoc copying of images, then both `crane` and `skopeo` are really useful.

If you want to follow along, first we'll create a temporary registry locally (you'll need a container runtime, we'll use [Docker](https://docker.com/)) so we can use that for this demo:

```shell
docker run --rm -d -p 5000:5000 registry:2
```

We can use `crane` to check the registry is working:

```shell
crane catalog localhost:5000
```

Nothing will be returned as this is an empty registry. Now let's copy an image to our registry. With `crane` we can use:

```shell
$ crane copy busybox:1.36 localhost:5000/library/busybox:1.36
2023/01/13 16:39:29 Copying from busybox:1.36 to localhost:5000/library/busybox:1.36
2023/01/13 16:39:47 pushed blob: sha256:66ba00ad3de8677a3fa4bc4ea0fc46ebca0f14db46ca365e7f60833068dd0148
2023/01/13 16:39:47 pushed blob: sha256:205dae5015e78dd8c4d302e3db4eb31576fac715b46d099fe09680ba28093a7a
2023/01/13 16:39:47 localhost:5000/library/busybox@sha256:907ca53d7e2947e849b839b1cd258c98fd3916c60f2e6e70c30edbf741ab6754: digest: sha256:907ca53d7e2947e849b839b1cd258c98fd3916c60f2e6e70c30edbf741ab6754 size: 528
2023/01/13 16:39:48 pushed blob: sha256:99ee43e96ff50e90c5753954d7ce2dfdbd7eb9711c1cd96de56d429cb628e343
2023/01/13 16:39:48 pushed blob: sha256:4c45e4bb3be9dbdfb27c09ac23c050b9e6eb4c16868287c8c31d34814008df80
2023/01/13 16:39:48 localhost:5000/library/busybox@sha256:dde8e930c7b6a490f728e66292bc9bce42efc9bbb5278bae40e4f30f6e00fe8c: digest: sha256:dde8e930c7b6a490f728e66292bc9bce42efc9bbb5278bae40e4f30f6e00fe8c size: 528
2023/01/13 16:39:48 pushed blob: sha256:a22ab831b2b2565a624635af04e5f76b4554d9c84727bf7e6bc83306b3b339a9
2023/01/13 16:39:49 pushed blob: sha256:b203a35cab50f0416dfdb1b2260f83761cb82197544b9b7a2111eaa9c755dbe7
2023/01/13 16:39:49 localhost:5000/library/busybox@sha256:4ff685e2bcafdab0d2a9b15cbfd9d28f5dfe69af97e3bb1987ed483b0abf5a99: digest: sha256:4ff685e2bcafdab0d2a9b15cbfd9d28f5dfe69af97e3bb1987ed483b0abf5a99 size: 527
2023/01/13 16:39:49 pushed blob: sha256:1d57ab16f681953c15d7485bf3ee79a49c2838e5f9394c43e20e9accbb1a2b20
2023/01/13 16:39:49 pushed blob: sha256:46758452d3eef8cacb188405495d52d265f0c3a7580dfec51cb627c04c7bafc4
2023/01/13 16:39:49 localhost:5000/library/busybox@sha256:77ed5ebc3d9d48581e8afcb75b4974978321bd74f018613483570fcd61a15de8: digest: sha256:77ed5ebc3d9d48581e8afcb75b4974978321bd74f018613483570fcd61a15de8 size: 528
2023/01/13 16:39:50 pushed blob: sha256:abaa813f94fdeebd3b8e6aeea861ab474a5c4724d16f1158755ff1e3a4fde8b0
2023/01/13 16:39:50 pushed blob: sha256:f78e6840ded1aafb6c9f265f52c2fc7c0a990813ccf96702df84a7dcdbe48bea
2023/01/13 16:39:50 localhost:5000/library/busybox@sha256:5e42fbc46b177f10319e8937dd39702e7891ce6d8a42d60c1b4f433f94200bd2: digest: sha256:5e42fbc46b177f10319e8937dd39702e7891ce6d8a42d60c1b4f433f94200bd2 size: 528
2023/01/13 16:39:50 pushed blob: sha256:9af22d424aada215bab8c43d48ba6c8e4ddae9018628ab2098f16520bfdcd6d8
2023/01/13 16:39:51 pushed blob: sha256:0b41f34c76745eef3d807afe679bea40ad0d84c1f109578ff017c870f2137589
2023/01/13 16:39:51 localhost:5000/library/busybox@sha256:1c8bbeaff20b74c3918ae3da99db0f0d8563adb33fcb346592e2882d82c28ab5: digest: sha256:1c8bbeaff20b74c3918ae3da99db0f0d8563adb33fcb346592e2882d82c28ab5 size: 528
2023/01/13 16:39:51 pushed blob: sha256:2bc9dea49d1a226db134bce761bfa89dd456109555c3ee4c490db84ad48d53b0
2023/01/13 16:39:51 pushed blob: sha256:7ef0bcd6b4899cdcc5d2c4e97aba3e60a0153a3201c1a9c810ed915975f3833e
2023/01/13 16:39:51 localhost:5000/library/busybox@sha256:e954aa43bc3d58a30a967d36b0b0ebf408eea4b1283106d2ca553b0243858d6b: digest: sha256:e954aa43bc3d58a30a967d36b0b0ebf408eea4b1283106d2ca553b0243858d6b size: 528
2023/01/13 16:39:52 pushed blob: sha256:93f830f96e6d4290268f3d7adb078a66ddc24c23dddbd4899fd72a8041a5a1c8
2023/01/13 16:39:52 pushed blob: sha256:95a526907ab34a09463a07cd768039ac815d433029f181a7731ef8dba3095bc4
2023/01/13 16:39:52 localhost:5000/library/busybox@sha256:db6ea0cbfcdfe2e7fff3f36b40c2c6ac27933977d71317b30c1905675ec29349: digest: sha256:db6ea0cbfcdfe2e7fff3f36b40c2c6ac27933977d71317b30c1905675ec29349 size: 528
2023/01/13 16:39:53 pushed blob: sha256:c3505dfdb7a6ef524d17d0ee391749f94de950c43642e3286e06172577e184a3
2023/01/13 16:39:53 pushed blob: sha256:688cd001103a44dc582d4fdc4647517422c0be7942c1278b5bb748395265375d
2023/01/13 16:39:53 localhost:5000/library/busybox@sha256:8f23e10f4610afdde9b856b9367742f1f5ded5c35e2aaa0630d3c5d9ebc2e4cf: digest: sha256:8f23e10f4610afdde9b856b9367742f1f5ded5c35e2aaa0630d3c5d9ebc2e4cf size: 527
2023/01/13 16:39:53 pushed blob: sha256:0af8c5262529b2acebe9e308296ea619f25b2b3b47c632f7ff154e931d18064c
2023/01/13 16:39:54 pushed blob: sha256:b49eda688ce8c1226b6d7e02969f22361a8874cfee14c603e98ad855f1267a94
2023/01/13 16:39:54 localhost:5000/library/busybox@sha256:069e43a261e5dd787655dbeba5eed96e40f4c9f80f024ecd5d2bd17aab357204: digest: sha256:069e43a261e5dd787655dbeba5eed96e40f4c9f80f024ecd5d2bd17aab357204 size: 528
2023/01/13 16:39:54 localhost:5000/library/busybox:1.36: digest: sha256:7b3ccabffc97de872a30dfd234fd972a66d247c8cfc69b0550f276481852627c size: 2295
```

Note that this copies all OS and architectures of the specified image if it is a multi-platform image. To only copy a single platform (very useful in testing):

```shell
$ crane copy busybox:1.36 localhost:5000/library/busybox:1.36 --platform linux/amd64
2023/01/12 17:15:11 Copying from busybox:1.36 to localhost:5000/library/busybox:1.36
2023/01/12 17:15:18 existing blob: sha256:205dae5015e78dd8c4d302e3db4eb31576fac715b46d099fe09680ba28093a7a
2023/01/12 17:15:18 existing blob: sha256:66ba00ad3de8677a3fa4bc4ea0fc46ebca0f14db46ca365e7f60833068dd0148
2023/01/12 17:15:19 localhost:5000/library/busybox:1.36: digest: sha256:907ca53d7e2947e849b839b1cd258c98fd3916c60f2e6e70c30edbf741ab6754 size: 528
```

To do the same with `skopeo`, we need to use a slightly different image reference:

```shell
$ skopeo copy docker://busybox:1.36 docker://localhost:5000/library/busybox:1.36 --dest-tls-verify=false
Getting image source signatures
Copying blob 205dae5015e7 skipped: already exists
Copying config 66ba00ad3d done
Writing manifest to image destination
Storing signatures
```

While the format for the `skopeo` command is a bit more involved, `skopeo` uses the scheme (`docker://` in the case above) to support multiple source and destination formats. Take a look at the `skopeo` [README](https://github.com/containers/skopeo/) for details.

Also note that `skopeo` by default will act on the image matching the OS/architecture of the host you're running `skopeo` on, whereas `crane` defaults to all platforms specified in the multi-arch image manifest (image index). To copy all architectures for an image with `skopeo`, specify the `--all` flag.

### Delete an image from a registry

This is especially useful during CI runs, to clean up temporary image builds from registries, or to clean up after failed releases (yes, it does happen!).

Unfortunately `registry:2` (the [Docker registry](https://docs.docker.com/registry/) image) only supports deleting via digest rather than tag, so this command is a bit more complicated:

```shell
crane delete "localhost:5000/library/busybox:1.36@$(crane digest localhost:5000/library/busybox:1.36)"
```

Note that this just deletes the root manifest. The actual filesystem layers are not deleted, but cannot be referenced via tag any longer. This is generally OK as it prevents accidental use of an invalid tagged image, but if you wan to delete all referenced digests you can script around that via something like:

```shell
$ crane manifest localhost:5000/library/busybox:1.36 | \
    gojq -r '.manifests[].digest' | \
    xargs -t -I{} crane delete localhost:5000/library/busybox:1.36@{}
$ crane delete "localhost:5000/library/busybox:1.36@$(crane digest localhost:5000/library/busybox:1.36)"
```

Depending on configuration, the registry would likely prune unreferenced blobs asnchronously to free up storage.

To delete an image with `skopeo`, run:

```shell
skopeo delete docker://localhost:5000/library/busybox:1.36 --tls-verify=false
```

`skopeo` handles the registry's lack of delete-by-tag support nicely by transparently sending the delete request with the required digest.

### List images and tags in a registry

To list images present in a registry, use `crane` (this is not supported by `skopeo`):

```shell
$ crane catalog localhost:5000
library/busybox
```

Listing tags available in a repository is equally simple with both tools:

```shell
$ crane ls localhost:5000/library/busybox
1.36

$ skopeo list-tags docker://localhost:5000/library/busybox --tls-verify=false
{
    "Repository": "localhost:5000/library/busybox",
    "Tags": [
        "1.36"
    ]
}
```

### Pull an image to a tarball

This is similar to `docker image pull`, but rather than pulling to cotainer runtime image storage, copies an image to a tarball.

```shell
$ crane pull busybox:1.36 busybox.tar

$ skopeo copy docker://busybox:1.36 docker-archive:busybox.tar
Getting image source signatures
Copying blob 205dae5015e7 done
Copying config 66ba00ad3d done
Writing manifest to image destination
Storing signatures
```

### Push from a tarball to a registry

This is similar to `docker image push`, but uses a tarball as source rather than container runtime image storage.

```shell
$ crane push busybox.tar localhost:5000/library/busybox:1.36

$ skopeo copy docker-archive:busybox.tar.gz docker://localhost:5000/library/busybox:1.36 --dest-tls-verify=false
Getting image source signatures
Copying blob 205dae5015e7 skipped: already exists
Copying config 66ba00ad3d done
Writing manifest to image destination
Storing signatures
```

## The winning feature (for me at least...)

While both `skopeo` and `crane` are great tools when used as CLI tools, `skopeo` cannot be used as a library (although there are lower level libraries in the [https://github.com/containers] GitHub org). `crane` on the other hand is very usable as a library, which as the creator of [`mindthegap`](https://github.com/mesosphere/mindthegap) (a tool to move image bundles specifically targeted for air-gapped use-cases) is a winning feature. Check out the awesome [godocs](https://pkg.go.dev/github.com/google/go-containerregistry@v0.12.1/pkg/crane) for crane.

## Summary

Both `crane` and `skopeo` are Swiss army knives for working with image registries. This post covers some of the more common use cases, but both `crane` and `skopeo` support many more operations. However, as `crane` can be used as a library as well as a CLI, it is my go-to tool.
