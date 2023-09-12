---
authors: ["jdyson"]
title: "Improved CRD Validation With Common Expression Language"
date: 2023-09-07T12:49:39+01:00
tags: ["kubernetes", "api"]
excerpt: 
feature_image: feature.webp
---

The [Kubernetes API][] is really quite a beautiful thing: a RESTful API provided via HTTP, using consistent [HTTP verbs][k8s api verbs] and [URIs][k8s uris] for accessing API resources, and allowing for deployment and versioning of multiple APIs.

And it even allows for extension... via the API itself. If you're reading this, you probably already know that, but every time I remember this it still impresses me!

The Kubernetes API resource used to declare API extensions is called [`CustomResourceDefinition`][CustomResourceDefinition] (`CRD` for short) and it is in the `apiextensions.k8s.io/v1` API group/version. When a `CRD` resource is created, the Kubernetes API server dynamically handles endpoints that follow the consistent API semantics as mentioned above. An API resource defined via a `CRD` feels just as native as the core Kubernetes APIs. The `CRD` defines the structure of the API resource for the Kubernetes API server to serve.

The Kubernetes API server will ensure that any requests to create or update instances (we'll call this a `CustomResource` or `CR` for the remainder of this post to distinguish from the definition, `CRD` of the API itself) of the newly defined resource are valid: they contain only properties defined in the CRD and those properties contain valid values. Validation failures will cause the invalid request to be denied and failure messages returned to the client.

There are a few ways to validate the contents when creating an instance of this CRD:

- [OpenAPI schema][] validation, usually defined via comments in code and generated into YAML manifests via `controller-gen` (more details [below](#validating-properties-via-openapi-schema)). Validation via OpenAPI schema is performed in-process by the Kubernetes API server, directly returning errors to the client.
- Webhook validation, defined in code and deployed as part of a controller manager pod (not discussed in this article). Validation happens by the API server sending requests to webhooks configured via the API, aggregating failures, and returning these to the client.
- [Common Expression Language][] validation, usually defined via comments in code and generated into YAML manifests via `controller-gen` (more details [below](#validating-properties-via-common-expression-language-cel)). Similar to OpenAPI schema validation, validation via CEL is performed in-process by the Kubernetes API server, directly returning errors to the client.

OpenAPI schema validation is the most basic as it only allows for validating types, formats, required, etc., and only can validate a single property in isolation. This is simple to understand, implement, and has the possibility of client-side support by virtue of using the widely supported OpenAPI schema to define validation rules.

[Webhook validation][] (also know as validating admission webhooks) is the most complex, requiring writing and deploying code, but with the complexity comes the most power: you can add any validation logic in your code, validate the whole resource, reach out to external systems... basically anything!

Common Expression Language validation will be discussed below and allows for complex validation without writing and deploying code (well, other than CEL code). It does not have the same level of flexibility as webhook validation, but allows for complex validations not supported by OpenAPI schema validation.

Let's work through an example, gradually adding validation rules. [Skip straight ahead to the section on CEL validation](#validating-properties-via-common-expression-language-cel) if you're familiar with CRD development - we're going to go slow and build up to validation via CEL.

## Demo project set up

For quick setup, follow the [`kubebuilder`][kubebuilder] [installation documentation][kubebuilder installation documentation]. We will also be setting up a local cluster using [KinD][] so [install][KinD installation] that too if you don't have a cluster to run against.

Let's create a project using `kubebuilder` (change any values you want to for your environment):

```bash
kubebuilder init --domain example.com
```

And create an API definition, our first CRD:

```bash
kubebuilder create api \
  --group placeholder \
  --version v1alpha1 \
  --kind Placeholder \
  --resource \
  --controller
```

This will create files containing boilerplate for your CRD, which in this case is called `Placeholder`. Create the deployment manifests, generated from the source code definition, via:

```bash
make manifests
```

Now you have everything you need to deploy your first CRD.

Take a look at the source code for the definition of the `Placeholder` struct that defines our CRD in Go code:

```bash
$ cat api/v1alpha1/placeholder_types.go

package v1alpha1

import (
    metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// EDIT THIS FILE!  THIS IS SCAFFOLDING FOR YOU TO OWN!
// NOTE: json tags are required.  Any new fields you add must have json tags for the fields to be serialized.

// PlaceholderSpec defines the desired state of Placeholder
type PlaceholderSpec struct {
    // INSERT ADDITIONAL SPEC FIELDS - desired state of cluster
    // Important: Run "make" to regenerate code after modifying this file

    // Foo is an example field of Placeholder. Edit placeholder_types.go to remove/update
    Foo string `json:"foo,omitempty"`
}

// PlaceholderStatus defines the observed state of Placeholder
type PlaceholderStatus struct {
    // INSERT ADDITIONAL STATUS FIELD - define observed state of cluster
    // Important: Run "make" to regenerate code after modifying this file
}

//+kubebuilder:object:root=true
//+kubebuilder:subresource:status

// Placeholder is the Schema for the placeholders API
type Placeholder struct {
    metav1.TypeMeta   `json:",inline"`
    metav1.ObjectMeta `json:"metadata,omitempty"`

    Spec   PlaceholderSpec   `json:"spec,omitempty"`
    Status PlaceholderStatus `json:"status,omitempty"`
}

//+kubebuilder:object:root=true

// PlaceholderList contains a list of Placeholder
type PlaceholderList struct {
    metav1.TypeMeta `json:",inline"`
    metav1.ListMeta `json:"metadata,omitempty"`
    Items           []Placeholder `json:"items"`
}

func init() {
    SchemeBuilder.Register(&Placeholder{}, &PlaceholderList{})
}
```

Note the kubebuilder annotations in Go comments starting with `//+kubebuilder:`. These are what `controller-gen` uses to generate the CRD definition when we ran `make manifests`:

```bash
$ cat config/crd/bases/placeholder.example.com_placeholders.yaml
---
apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  annotations:
    controller-gen.kubebuilder.io/version: v0.12.0
  name: placeholders.placeholder.example.com
spec:
  group: placeholder.example.com
  names:
    kind: Placeholder
    listKind: PlaceholderList
    plural: placeholders
    singular: placeholder
  scope: Namespaced
  versions:
  - name: v1alpha1
    schema:
      openAPIV3Schema:
        description: Placeholder is the Schema for the placeholders API
        properties:
          apiVersion:
            description: 'APIVersion defines the versioned schema of this representation
              of an object. Servers should convert recognized schemas to the latest
              internal value, and may reject unrecognized values. More info: https://git.k8s.io/community/contributors/devel/sig-architecture/api-conventions.md#resources'
            type: string
          kind:
            description: 'Kind is a string value representing the REST resource this
              object represents. Servers may infer this from the endpoint the client
              submits requests to. Cannot be updated. In CamelCase. More info: https://git.k8s.io/community/contributors/devel/sig-architecture/api-conventions.md#types-kinds'
            type: string
          metadata:
            type: object
          spec:
            description: PlaceholderSpec defines the desired state of Placeholder
            properties:
              foo:
                description: Foo is an example field of Placeholder. Edit placeholder_types.go
                  to remove/update
                type: string
            type: object
          status:
            description: PlaceholderStatus defines the observed state of Placeholder
            type: object
        type: object
    served: true
    storage: true
    subresources:
      status: {}
```

As you can see, all this is generated from the Go code comments.

## Validating properties via OpenAPI schema

CRDs support OpenAPI schema validation. We can use kubebuilder annotations to add some simple validations, in this case let's mark the `Foo` field of the `PlaceholderSpec` as an enum that only accepts `Bar` and `Baz`:

```go
	// Foo is an example field of Placeholder. Edit placeholder_types.go to remove/update
	// +kubebuilder:validation:Enum="Bar";"Baz"
	Foo string `json:"foo,omitempty"`
```

Regenerate the CRD manifests:

```bash
make manifests
```

And looking at the generated manifests again the enum is added to the OpenAPI spec:

```yaml
foo:
  description: Foo is an example field of Placeholder. Edit placeholder_types.go
    to remove/update
  enum:
  - Bar
  - Baz
  type: string
```

## Deploy and test out the validation

If you don't have a cluster to use, then first create one with KinD:

```bash
kind create cluster
```

Deploy the CRD and controller on to the cluster:

```bash
make install
```

Test out the validation by trying to create an invalid CR:

```bash
$ cat <<EOF | kubectl apply --server-side -f -
apiVersion: placeholder.example.com/v1alpha1
kind: Placeholder
metadata:
  name: myplaceholder
spec:
 foo: INVALID
EOF
The Placeholder "myplaceholder" is invalid: spec.foo: Unsupported value: "INVALID": supported values: "Bar", "Baz"
```

Validation works!

Creating a valid resource:

```bash
$ cat <<EOF | kubectl apply --server-side -f -
apiVersion: placeholder.example.com/v1alpha1
kind: Placeholder
metadata:
  name: myplaceholder
spec:
 foo: Bar
EOF
placeholder.placeholder.example.com/myplaceholder serverside-applied
```

Perfect!

As discussed above, OpenAPI schema validation is perfect for simple, single property validation. However, if you need to do more complex validations, then you're going to need something more powerful. We could use webhook validation, but we're going to explore CEL validation instead.

## Validating properties via Common Expression Language (CEL)

The [validation rules][] feature (via the `CustomResourceValidationExpressions` feature gate) moved to beta (and therefore enabled by default) in Kubernetes v1.25. Validation rules enable the use of CEL to validate custom resource values.

CEL describes itself as implementing `common semantics for expression evaluation, enabling different applications to more easily interoperate`. It has a similar syntax to expressions in C, Java, JavaScript, and Go, which makes it easy for developers to understand and use.

We'll work through some examples below to try to highlight the benefits of using CEL for validation, but the major benefit is not having to maintain and deploy extra code for validations that can be expressed clearly and concisely via CEL. Note that CEL is really powerful and these examples are not exhaustive. Take a look at the [Kubernetes documentation][validation rules] for further reading.

We can add CEL validation rules via kubebuilder annotations, just as we did with OpenAPI schema validation. Let's add a couple of properties, `min`, `max`, and `current`, and add validation rules that `min <= max`, and `min <= current <= max`.

```go
// +kubebuilder:validation:XValidation:message="min must be less than or equal to max",rule="self.min <= self.max"
// +kubebuilder:validation:XValidation:message="current must be between min and max inclusive",rule="self.min <= self.current && self.current <= self.max"
type PlaceholderSpec struct {
	// INSERT ADDITIONAL SPEC FIELDS - desired state of cluster
	// Important: Run "make" to regenerate code after modifying this file

	// Foo is an example field of Placeholder. Edit placeholder_types.go to remove/update
	// +kubebuilder:validation:Enum="Bar";"Baz"
	Foo string `json:"foo,omitempty"`

	// +kubebuilder:validation:Minimum=0
	// +kubebuilder:validation:Maximum=10
	// +kubebuilder:default=0
	Min int32     `json:"min"`
	// +kubebuilder:validation:Minimum=0
	// +kubebuilder:validation:Maximum=10
	// +kubebuilder:default=10
	Max int32     `json:"max"`
	// +kubebuilder:validation:Minimum=0
	// +kubebuilder:validation:Maximum=10
	// +kubebuilder:validation:Required
	Current int32 `json:"current"`
}
```

Run `make manifests` and look at the generated CRD manifest (showing just the relevant parts):

```yaml
          spec:
            description: PlaceholderSpec defines the desired state of Placeholder
            properties:
              current:
                format: int32
                maximum: 10
                minimum: 0
                type: integer
              foo:
                description: Foo is an example field of Placeholder. Edit placeholder_types.go
                  to remove/update
                enum:
                - Bar
                - Baz
                type: string
              max:
                default: 10
                format: int32
                maximum: 10
                minimum: 0
                type: integer
              min:
                default: 0
                format: int32
                maximum: 10
                minimum: 0
                type: integer
            required:
            - current
            - max
            - min
            type: object
            x-kubernetes-validations:
            - message: min must be less than or equal to max
              rule: self.min <= self.max
            - message: current must be between min and max inclusive
              rule: self.min <= self.current && self.current <= self.max
```

Our build annotations above combined both OpenAPI validations to add minimum, maximum, and defaults to the `min`, `max`, and `current` properties, and add the CEL validation rules via the `x-kubernetes-validations` schema extension. This is used by the API server to run the specified validations.

Notice how we set the validation rule on the `PlaceholderSpec` object in our Go code. This sets the scope of the rule, i.e. the `self` variable in the CEL validation will be set to the value of the property that is annotated when the rule is evaluated. This allows for access to any properties below this point in the object, but not up. Be mindful of this when specifying your validation rules, and limit the scope as much as necessary by placing your validation rules at the appropriate level in your object.

Let's test these validation rules out by first deploying them:

```bash
make install
```

And then updating the CR we created earlier:

```bash
$ cat <<EOF | kubectl apply --server-side -f -
apiVersion: placeholder.example.com/v1alpha1
kind: Placeholder
metadata:
  name: myplaceholder
spec:
 foo: Bar
 min: 1
 max: 0
 current: 10
EOF
The Placeholder "myplaceholder" is invalid:
* spec: Invalid value: "object": min must be less than or equal to max
* spec: Invalid value: "object": current must be between min and max inclusive
```

Again our validations worked! The error message is what we specified on the Kubebuilder annotation. Validation rules actually support a wider range of options related to the client response, but these are not directly supported by Kubebuilder annotations at the time of writing. See the [validation rules][] for more details - you can of course edit the generated CRD manifest (or use [Kustomize][] patches) if you want to add more options to the validation rules.

Kubernetes CEL validation also includes something called [transition rules][], which enables comparing the requested state with the previous state. This allows for some very common use cases that could previously only be achieved by creating validating admission webhooks, in particular immutable properties and enforcing what values are allowed to be set considering the previous value, i.e. only allowing valid requested state changes.

A transition rule is implicitly created by referencing the `oldSelf` variable. Let's implement this to make the `max` property immutable by adding the kubebuilder annotation directly on the `Max` field in our struct, limiting the scope of the rule as much as possible:

```go
	// +kubebuilder:validation:Minimum=0
	// +kubebuilder:validation:Maximum=10
	// +kubebuilder:default=10
	// +kubebuilder:validation:XValidation:message="max is immutable",rule="self == oldSelf"
	Max int32     `json:"max"`
```

Generating and deploying our updated CRD as we did before:

```bash
make install
```

And testing it out, first by creating a valid CR:

```bash
$ cat <<EOF | kubectl apply --server-side -f -
apiVersion: placeholder.example.com/v1alpha1
kind: Placeholder
metadata:
  name: myplaceholder
spec:
 foo: Bar
 min: 1
 max: 5
 current: 5
EOF
placeholder.placeholder.example.com/myplaceholder serverside-applied
```

Then trying to change the `max` property:

```bash
$ cat <<EOF | kubectl apply --server-side -f -
apiVersion: placeholder.example.com/v1alpha1
kind: Placeholder
metadata:
  name: myplaceholder
spec:
 foo: Bar
 min: 1
 max: 10
 current: 5
EOF
The Placeholder "myplaceholder" is invalid: spec.max: Invalid value: "integer": max is immutable
```

Awesome stuff!

## Conclusion

This post gives a brief introduction to using CEL for validating your CRDs. The CEL implementation in Kubernetes has a pretty extensive [library of validation functions][] to use in your CEL expressions - it is pretty powerful stuff.

As we have slowly started migrating to CEL in our CRDs, we have been able to delete the code for a number of our validating webhooks, without sacrificing data integrity or expressiveness. While CEL is not necessarily simple for non-developers to understand, it also has the benefit of appearing in the CRD spec, which adds a layer of transparency compared to the opaque nature of validating webhooks.

As CEL is becoming more widely used in Kubernetes (e.g. [validating admission policy][] graduating to beta in Kubernetes v1.28), it is a good time to familiarize yourself with it and see where you can apply it to simplify and enhance your application deployments.

[Kubernetes API]: https://kubernetes.io/docs/reference/using-api/api-concepts/
[k8s api verbs]:https://kubernetes.io/docs/reference/using-api/api-concepts/#api-verbs
[k8s uris]: https://kubernetes.io/docs/reference/using-api/api-concepts/#resource-uris
[CustomResourceDefinition]: https://kubernetes.io/docs/tasks/extend-kubernetes/custom-resources/custom-resource-definitions/
[kubebuilder]: https://book.kubebuilder.io/
[kubebuilder installation documentation]: https://book.kubebuilder.io/quick-start#installation
[KinD]: https://kind.sigs.k8s.io/
[KinD installation]: https://kind.sigs.k8s.io/docs/user/quick-start/#installation
[validation rules]: https://kubernetes.io/docs/tasks/extend-kubernetes/custom-resources/custom-resource-definitions/#validation-rules
[Common Expression Language]: https://github.com/google/cel-spec
[OpenAPI schema]: https://www.openapis.org/
[Webhook validation]: https://kubernetes.io/docs/reference/access-authn-authz/extensible-admission-controllers/
[Kustomize]: https://kustomize.io/
[transition rules]: https://kubernetes.io/docs/tasks/extend-kubernetes/custom-resources/custom-resource-definitions/#transition-rules
[library of validation functions]: https://kubernetes.io/docs/tasks/extend-kubernetes/custom-resources/custom-resource-definitions/#available-validation-functions
[validating admission policy]: https://kubernetes.io/docs/reference/access-authn-authz/validating-admission-policy/
