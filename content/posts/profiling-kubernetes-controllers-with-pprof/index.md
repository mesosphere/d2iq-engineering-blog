---
authors: ["cbuto"]
title: "Profiling Kubernetes Controllers With pprof"
date: 2023-08-23T16:53:33-04:00
tags: ["kubernetes", "pprof", "kubernetes controllers", "performance"]
excerpt: Profiling Kubernetes controllers with pprof to help analyze and resolve performance issues
feature_image: feature.png
---

# Analyzing Kubernetes controllers performance with pprof

`pprof` is a Go standard library package which provides tooling for collecting and analyzing profiling data from Go applications. 
Once a profile is collected from an application, it can be analyzed and visualized with the `go tool pprof` command. 
A common technique for collecting profiles from Go applications is to import the [`"net/http/pprof"`][pprof] 
package which will register endpoints on an existing HTTP server under the `/debug/pprof/` URL that can be used 
to download live profiles from a running application.

`pprof` can be easily integrated into your Kubernetes controllers to help gain deeper understanding of how a controller
is behaving at runtime with little performance overhead.

### What is a profile? 

The Godoc for a [`Profile`][pprof profile] describes them as:

>A Profile is a collection of stack traces showing the call sequences that led to instances of a particular event, such as allocation.

In other words, a profile is a set of stack traces collected from a running Go application with some additional
metadata attached to each stack trace which provides insight into how the application is running. This additional data
might included things like memory allocation information or CPU timing of function calls.

There are a set of predefined profiles which cover most profiling use cases (heap, cpu, etc); however, it is possible 
to write custom profiles if you have a specific use case that isn't covered in the builtin profiles.
 
The predefined profiles are as follows:
```
goroutine    - stack traces of all current goroutines
heap         - a sampling of memory allocations of live objects
allocs       - a sampling of all past memory allocations
threadcreate - stack traces that led to the creation of new OS threads
block        - stack traces that led to blocking on synchronization primitives
mutex        - stack traces of holders of contended mutexes
```

## Profiling Kubernetes controllers

Now that we know a little bit about `pprof` and profiling, we can look at why we might need this for Kubernetes controllers. Much like
any other application, Kubernetes controllers are prone to suffering from performance issues, running out of memory, etc.

If your controller is being `OOMKilled`, instead of just simply increasing the memory limits and moving on, we can
actually understand what is using up all the memory by collecting and analyzing `heap` or `goroutine` profiles. 

Another example scenario where profiling might help is if a controller is suffering from performance issues when running
at scale, collecting a `cpu` profile can help identify functions that are using the most CPU time.

### Enabling `pprof` via controller-runtime

As of `controller-runtime` version v0.15.0, enabling the `pprof` server can be accomplished by specifying the `PprofBindAddress`
option on the controller `manager`. Prior to v0.15.0, it was possible to enable profiling but required manually adding 
each `pprof` endpoint to the existing metrics server via the 
[`AddMetricsExtraHandler`][AddMetricsExtraHandler] method.

Enabling the `pprof` server on your controller(s) is as simple as this:

```go
opts := ctrl.Options{
    // additional options 
    PprofBindAddress:  "127.0.0.1:8081",
}

mgr, err := ctrl.NewManager(ctrl.GetConfigOrDie(), opts)
if err != nil {
    setupLog.Error(err, "unable to start manager")
    os.Exit(1)
}
```

I'd recommend always enabling profiling on your Kubernetes controllers by default because you will never know when you need it to debug
a performance issue until its too late. Keeping it disabled by default will prevent you from to easily debugging performance issues when they pop up because
enabling the `pprof` server will require restarting the pod.

Note: The `pprof` endpoints expose sensitive information so they should always be bound to `127.0.0.1` 
or kept private by other techniques (i.e. using [kube-rbac-proxy][kube-rbac-proxy])

### Collecting and analyzing profiles

Now that we have profiling enabled on our controllers, we can simply port-forward to the controller pod and collect profiles.

```bash
kubectl port-forward pod/<pod> 8081:8081
```

Collect a CPU profile:

```bash
curl -s "http://127.0.0.1:8081/debug/pprof/profile" > ./cpu-profile.out
```

Open the `pprof` web interface to analyze the profile:

```bash
go tool pprof -http=:8080 ./cpu-profile.out
```

Tip: I find flame graphs to be the one of the most valuable visualizations when analyzing most profiles, which can be
done by navigating to [http://localhost:8080/ui/flamegraph](http://localhost:8080/ui/flamegraph).


[kube-rbac-proxy]: https://github.com/brancz/kube-rbac-proxy
[AddMetricsExtraHandler]: https://pkg.go.dev/sigs.k8s.io/controller-runtime@v0.14.6/pkg/manager#Manager.AddMetricsExtraHandler
[pprof profile]: https://pkg.go.dev/runtime/pprof#Profile
[pprof]: https://pkg.go.dev/net/http/pprof
