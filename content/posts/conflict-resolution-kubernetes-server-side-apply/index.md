---
authors: ["jdyson"]
title: "Conflict Resolution: Kubernetes Server-Side Apply"
date: 2023-07-24T11:09:05+01:00
excerpt: Granular resource ownership in the Kubernetes API
feature_image: feature.webp
tags: ["kubernetes", "api"]
---

On the [Kubernetes][] website, Kubernetes is [described][k8s description] as:

> a portable, extensible, open source platform for managing containerized workloads and services, that facilitates both
> declarative configuration and automation

Most people know Kubernetes as a container orchestration platform, automating the deployment and running of workloads
across fleets of machines. Since the inception of the project, Kubernetes adoption has exploded. Containerization is the
new standard way to run workloads, driven in large part by Kubernetes. Kubernetes is not the only container
orchestration platform out there, some notable others being [Nomad][] and [Docker Swarm][]. So what is it that sets
Kubernetes apart and has led to it becoming the most widely adopted container orchestration platform, ubiquitous across
all major cloud providers and on-premises? Is it really the best technically and the most capable? Arguably not (take a
look at the comparison on the [Nomad site][nomad comparison] - obviously biased, but actually pretty fair). So if there
are comparable container orchestration engines, what is it that has made Kubernetes so successful (other than marketing
and hype!)?

One of the major factors in the success of Kubernetes is the architecture: a declarative API that users declare their
desired state, and asynchronous control loops that attempt to satisfy the users' desire by continually observing state
and reconciling that with the desired state, doing whatever work is required to bring the two into alignment. These
control loops then report the status back to the same API as the user used to specify their desired state. This model is
applied by all components in the Kubernetes architecture, from the control plane components to custom controllers and
operators.

That means that one thing lies at the centre of the Kubernetes universe: the API server. Let's strip the API server back
to its very basic functions; it receives requests, validates them, applies RBAC policies, and reads and writes to and
from storage. Generally that data store is [etcd][].

In the architecture described above, there are almost always concurrent writes to the API. [etcd][] generally handles
that very well when those concurrent writes are against different resources. [etcd][] doesn't provide [transactions][]
(as used in relational databases for pessimistic locking), so how does [Kubernetes][] handle concurrent conflicting
writes to the same resource? We'll get to Server-Side Apply soon, promise!

## Conflicting creates

Let's try creating something in parallel and see what happens (this is going to use [GNU Parallel][] so install it if
you want to try it out for yourself). We'll first create a number of YAML-formatted manifests for a namespace called
`ssa-blog-demo`, but with one difference: a different label in each file.

```bash
$ ssa_tmp="$(mktemp -d /tmp/ssa-blog-demo-XXXXXX)"

$ for i in $(seq 5); do
 cat <<EOF >"${ssa_tmp}/${i}.yaml"
apiVersion: v1
kind: Namespace
metadata:
  name: ssa-blog-demo
  labels:
    label${i}: "${i}"
EOF
done

$ parallel kubectl create -f ::: "${ssa_tmp}/*.yaml"
namespace/ssa-blog-demo created
Error from server (AlreadyExists): error when creating "/tmp/ssa-blog-demo-rmmgyw/2.yaml": namespaces "ssa-blog-demo" already exists
Error from server (AlreadyExists): error when creating "/tmp/ssa-blog-demo-rmmgyw/4.yaml": namespaces "ssa-blog-demo" already exists
Error from server (AlreadyExists): error when creating "/tmp/ssa-blog-demo-rmmgyw/5.yaml": namespaces "ssa-blog-demo" already exists
Error from server (AlreadyExists): error when creating "/tmp/ssa-blog-demo-rmmgyw/1.yaml": namespaces "ssa-blog-demo" already exists
```

So we tried to create the same resource multiple times and only one succeeded - which makes total. If you run this, your
output will be slightly different as a different one of the parallel creates will work. In this case, it was the 5th
file as we can see when we read back from the API server:

```bash
$ kubectl get ns --show-labels ssa-blog-demo
NAME            STATUS   AGE     LABELS
ssa-blog-demo   Active   2m44s   kubernetes.io/metadata.name=ssa-blog-demo,label3=3
```

Notice the `number=3` label on line 3 above.

So we can't create multiple resources with the same name. Good. Conflicting creates work exactly as expected.

## Concurrent updates

Let's use the same files, but this time let's use `kubectl apply` and see what happens:

```bash
$ parallel kubectl apply -f ::: "${ssa_tmp}/*.yaml"
namespace/ssa-blog-demo configured
namespace/ssa-blog-demo configured
namespace/ssa-blog-demo configured
namespace/ssa-blog-demo configured
namespace/ssa-blog-demo configured

$ NAME            STATUS   AGE     LABELS
ssa-blog-demo     Active   7m39s   kubernetes.io/metadata.name=ssa-blog-demo,label2=2
```

We applied multiple files at the same time and one succeeded, in this case setting the label `number=2`. Let's do it
again and see what happens:

```bash
NAME            STATUS   AGE     LABELS
ssa-blog-demo   Active   10m     kubernetes.io/metadata.name=ssa-blog-demo,label5=5
```

We applied the same files again and we get a different label applied, previous state is overwritten. Now imagine if this
happens in the real world: multiple API clients (users or controllers) updating fields in the API at the same time, the
last one to apply wins. That leads to competition and races - who knows what the state should actually be in this case?
Overwriting changes from other API clients would lead to fighting for ownership of the resource and unnecessary work by
controllers as the API resources continually change their desired state.

## Enter `resourceVersion`

Every resource has a field that is updated every time the resource is updated:

```bash
$ kubectl get ns ssa-blog-demo -oyaml
apiVersion: v1
kind: Namespace
metadata:
  annotations:
    kubectl.kubernetes.io/last-applied-configuration: |
      {"apiVersion":"v1","kind":"Namespace","metadata":{"annotations":{},"labels":{"label4":"4"},"name":"ssa-blog-demo"}}
  creationTimestamp: "2023-07-25T15:24:41Z"
  labels:
    kubernetes.io/metadata.name: ssa-blog-demo
    label4: "4"
  name: ssa-blog-demo
  resourceVersion: "4467"
  uid: 197fa2f8-0f9b-482b-83f8-22c5c052e392
spec:
  finalizers:
  - kubernetes
status:
  phase: Active
```

See line 14 above: `resourceVersion: "4467"`. That `resourceVersion` can be used for optimistic locking by including it
in the update request. If the `resourceVersion` in the request doesn't match the current `resourceVersion` stored in the
API then the request is rejected. Let's try it by updating all the files to apply and add the `resourceVersion` so that
it will be included in every request:

```bash
$ sed -i 's/\(name: ssa-blog-demo\)/\1\n  resourceVersion: "4467"/' ${ssa_tmp}/*.yaml

$ cat ${ssa_tmp}/1.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: ssa-blog-demo
  resourceVersion: "4467"
  labels:
    label1: "1"
```

Now let's apply the files again in parallel and see what happens:

```bash
$ parallel kubectl apply -f ::: ${ssa_tmp}/*.yaml
namespace/ssa-blog-demo configured
Error from server (Conflict): error when applying patch:
{"metadata":{"annotations":{"kubectl.kubernetes.io/last-applied-configuration":"{\"apiVersion\":\"v1\",\"kind\":\"Namespace\",\"metadata\":{\"annotations\":{},\"labels\":{\"label2\":\"2\"},\"name\":\"ssa-blog-demo\",\"resourceVersion\":\"4467\"}}\n"},"labels":{"label1":null,"label2":"2"},"resourceVersion":"4467"}}
to:
Resource: "/v1, Resource=namespaces", GroupVersionKind: "/v1, Kind=Namespace"
Name: "ssa-blog-demo", Namespace: ""
for: "/tmp/ssa-blog-demo-lkBf2r/2.yaml": error when patching "/tmp/ssa-blog-demo-lkBf2r/2.yaml": Operation cannot be fulfilled on namespaces "ssa-blog-demo": the object has been modified; please apply your changes to the latest version and try again
<REPEATED>
```

So only one applied, and the rest were rejected because of wrong `resourceVersion`, indicating that the client has an
out of date request. Optimistic locking ftw!

```bash
$ kubectl get ns ssa-blog-demo --show-labels
NAME            STATUS   AGE   LABELS
ssa-blog-demo   Active   28m   kubernetes.io/metadata.name=ssa-blog-demo,label1=1
```

Now we can deal with concurrent updates via optimistic locking. But there is a big downside to this approach: every
update has to include the fully declared resource, even if the API client only wants to change a single field. For this
simple example, that isn't so bad, but imagine if we're using complicated CRDs that have many fields and the API client
only wants to update a single field. The usual client flow for this is to retrieve the resource, edit the resource,
apply the resource. If in conflict, repeat the process. This is pretty redundant. What else can we do?

We could use patch, which allows an API client to send in only the changes they want to apply to the specified resource
in either a [JSON patch][] or [strategic merge patch][], but this suffers from the same problem as using update: either
competing updates, or a requirement for optimistic locking via `resourceVersion`.

Can we do any better? Yes! Enter [Server-Side Apply][].

## Server-Side Apply

[Server-Side Apply][] (SSA) graduated to stable quite a while ago, in Kubernetes v1.22. It is such an important concept
for API clients, especially authors of controllers and operators to understand. The promise of [Server-Side Apply][] is
to allow multiple API clients to apply their changes to objects without conflicts, without the need for the
read-edit-apply retry loops as described above, and with the API client only specifying the fields that they want to
change, as opposed to the whole resource (in this way it can be considered similar to strategic merge patches). This is
done via tracking the "manager" of each field in an object. We will simulate that by using labels on the namespace
resource we have been using throughout this blog post. Let's take a look at the namespace resource above we've been
using above:

```bash
$ kubectl get ns ssa-blog-demo -oyaml --show-managed-fields
apiVersion: v1
kind: Namespace
metadata:
  annotations:
    kubectl.kubernetes.io/last-applied-configuration: |
      {"apiVersion":"v1","kind":"Namespace","metadata":{"annotations":{},"labels":{"label1":"1"},"name":"ssa-blog-demo","resourceVersion":"4467"}}
  creationTimestamp: "2023-07-25T15:24:41Z"
  labels:
    kubernetes.io/metadata.name: ssa-blog-demo
    label1: "1"
  managedFields:
  - apiVersion: v1
    fieldsType: FieldsV1
    fieldsV1:
      f:metadata:
        f:labels:
          .: {}
          f:kubernetes.io/metadata.name: {}
    manager: kubectl-create
    operation: Update
    time: "2023-07-25T15:24:41Z"
  - apiVersion: v1
    fieldsType: FieldsV1
    fieldsV1:
      f:metadata:
        f:annotations:
          .: {}
          f:kubectl.kubernetes.io/last-applied-configuration: {}
        f:labels:
          f:label1: {}
    manager: kubectl-client-side-apply
    operation: Update
    time: "2023-07-25T15:51:49Z"
  name: ssa-blog-demo
  resourceVersion: "5191"
  uid: 197fa2f8-0f9b-482b-83f8-22c5c052e392
spec:
  finalizers:
  - kubernetes
status:
  phase: Active
```

As you can see this info is pretty verbose so is hidden from `kubectl` unless you add the `--show-managed-fields` flag.

From lines 12-34 above we can see that the Kubernetes API server tracks which clients update which fields. A client that
updates a field becomes a field manager. Let's try to update the value of label `label1` via SSA using `kubectl apply
--server-side`:

```bash
$ kubectl apply --server-side -f <(cat <<EOF
apiVersion: v1
kind: Namespace
metadata:
  name: ssa-blog-demo
  labels:
    label1: a_new_value
EOF
)
namespace/ssa-blog-demo serverside-applied
```

And the label is correctly updated:

```bash
$ kubectl get ns ssa-blog-demo --show-labels
NAME            STATUS   AGE   LABELS
ssa-blog-demo   Active   59m   kubernetes.io/metadata.name=ssa-blog-demo,label1=a_new_value
```

Now let's use SSA to add a new label:

```bash
kubectl apply --server-side -f <(cat <<EOF
apiVersion: v1
kind: Namespace
metadata:
  name: ssa-blog-demo
  labels:
    newlabel: value
EOF
)
```

Let's take a look at our new label:

```bash
$ kubectl get ns ssa-blog-demo --show-labels
NAME            STATUS   AGE   LABELS
ssa-blog-demo   Active   59m   kubernetes.io/metadata.name=ssa-blog-demo,newlabel=value
```

Wait - the new label is there, but the old one is gone. What's happened?

Here's the gotcha: when using SSA, a client must send every field that it manages (aka fully specified intent). Not
sending a field in the SSA request tells the API server that the client does not want to manage the field any more,
which makes the API server delete the field if there is no other manager of that field (more on that later).

So let's try that again, but this time let's send the `label1` label as well to show that both labels are retained:

```bash
$ kubectl apply --server-side -f <(cat <<EOF
apiVersion: v1
kind: Namespace
metadata:
  name: ssa-blog-demo
  labels:
    label1: value1
    newlabel: value
EOF
)

$ kubectl get ns ssa-blog-demo --show-labels
NAME            STATUS   AGE   LABELS
ssa-blog-demo   Active   59m   kubernetes.io/metadata.name=ssa-blog-demo,label1=value1newlabel=value
```

Phew, our labels are back!

Now consider what happens if a different API client now tries to update the value of a field, in this case just the
value of the `label1` label:

```bash
$ kubectl apply --server-side --field-manager=new-field-manager -f <(cat <<EOF
apiVersion: v1
kind: Namespace
metadata:
  name: ssa-blog-demo
  labels:
    label1: a_new_value
EOF
)
error: Apply failed with 1 conflict: conflict with "kubectl": .metadata.labels.label1
Please review the fields above--they currently have other managers. Here
are the ways you can resolve this warning:
* If you intend to manage all of these fields, please re-run the apply
  command with the `--force-conflicts` flag.
* If you do not intend to manage all of the fields, please edit your
  manifest to remove references to the fields that should keep their
  current managers.
* You may co-own fields by updating your manifest to match the existing
  value; in this case, you'll become the manager if the other manager(s)
  stop managing the field (remove it from their configuration).
See https://kubernetes.io/docs/reference/using-api/server-side-apply/#conflicts
```

What a great error message! So because the field `metadata.labels.label1` has a different field manager (as we saw
above, in this case it was `kubectl-client-side-apply`) than the field manager we specified via the `--field-manager`
flag, the API server rejects the request.

If we do want to overwrite that, we can force conflicts via the `--force-conflicts` flag:

```bash
$ kubectl apply --server-side --field-manager=new-field-manager --force-conflicts -f <(cat <<EOF
apiVersion: v1
kind: Namespace
metadata:
  name: ssa-blog-demo
  labels:
    label1: a_new_value
EOF
)
namespace/ssa-blog-demo serverside-applied

$ kubectl get ns ssa-blog-demo --show-labels
NAME            STATUS   AGE   LABELS
ssa-blog-demo   Active   70m   kubernetes.io/metadata.name=ssa-blog-demo,label1=a_new_value,newlabel=value
```

Notice how the value of `label1` has been updated, but `newlabel` continues to exist. Let's take a look at the field
managers:

```bash
$ kubectl get ns ssa-blog-demo -oyaml --show-managed-fields
apiVersion: v1
kind: Namespace
metadata:
  annotations:
    kubectl.kubernetes.io/last-applied-configuration: |
      {"apiVersion":"v1","kind":"Namespace","metadata":{"labels":{"label1":"value1","newlabel":"value"},"name":"ssa-blog-demo"}}
  creationTimestamp: "2023-07-25T15:24:41Z"
  labels:
    kubernetes.io/metadata.name: ssa-blog-demo
    label1: a_new_value
    newlabel: value
  managedFields:
  - apiVersion: v1
    fieldsType: FieldsV1
    fieldsV1:
      f:metadata:
        f:annotations:
          f:kubectl.kubernetes.io/last-applied-configuration: {}
    manager: kubectl-last-applied
    operation: Apply
  - apiVersion: v1
    fieldsType: FieldsV1
    fieldsV1:
      f:metadata:
        f:labels:
          f:newlabel: {}
    manager: kubectl
    operation: Apply
    time: "2023-07-25T16:29:18Z"
  - apiVersion: v1
    fieldsType: FieldsV1
    fieldsV1:
      f:metadata:
        f:labels:
          f:label1: {}
    manager: new-field-manager
    operation: Apply
    time: "2023-07-25T16:34:41Z"
  - apiVersion: v1
    fieldsType: FieldsV1
    fieldsV1:
      f:metadata:
        f:labels:
          .: {}
          f:kubernetes.io/metadata.name: {}
    manager: kubectl-create
    operation: Update
    time: "2023-07-25T15:24:41Z"
  name: ssa-blog-demo
  resourceVersion: "8536"
  uid: 197fa2f8-0f9b-482b-83f8-22c5c052e392
spec:
  finalizers:
  - kubernetes
status:
  phase: Active
```

Notice on lines 31-39 that the field manager of `metadata.labels.label1` has now been updated to be `new-field-manager`
as we specified above.

Forcing conflicts is essential for controllers that do not have any other way to resolve conflicts. In this case it is
extremely important to ensure that your controllers do not compete with other controllers for management of fields, or
we will end up in the API churn mentioned above, continually undoing each others' changes.

## Conclusion

In this blog post, I have tried to illustrate the different conflict resolution techniques for Kubernetes clients, and
how SSA can be applied to manage conflicts with resorting to read-edit-update retry loops. For further reading, I highly
recommend checking out the [Server-Side Apply] documentation, including details on how SSA handles [merge strategies][]
for lists and maps, and [transferring ownership][].

[Kubernetes]: https://kubernetes.io/
[k8s description]: https://kubernetes.io/docs/concepts/overview/
[Nomad]: https://www.nomadproject.io/
[Docker Swarm]: https://docs.docker.com/engine/swarm/
[nomad comparison]: https://developer.hashicorp.com/nomad/docs/nomad-vs-kubernetes/
[etcd]: https://etcd.io/
[transactions]: https://en.wikipedia.org/wiki/Database_transaction
[GNU Parallel]: https://www.gnu.org/software/parallel/
[JSON patch]: https://jsonpatch.com/
[strategic merge patch]:
    https://kubernetes.io/docs/tasks/manage-kubernetes-objects/update-api-object-kubectl-patch/#use-a-strategic-merge-patch-to-update-a-deployment
[Server-Side Apply]: https://kubernetes.io/docs/reference/using-api/server-side-apply/
[merge strategies]: https://kubernetes.io/docs/reference/using-api/server-side-apply/#merge-strategy
[transferring ownership]: https://kubernetes.io/docs/reference/using-api/server-side-apply/#transferring-ownership
