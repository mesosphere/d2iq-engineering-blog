---
authors: ["jdyson"]
title: "A Long Journey to Cross Platform Developer Tooling Utopia (For Now)"
date: 2023-07-19T10:39:28+01:00
featured: false
tags: ["development"]
feature_image: feature.webp
excerpt: Streamlining the developer experience.
---

Over the 25 or so years of being a software engineer, I've worked on many projects for quite a few different companies.
At the start of my career, developer tooling was pretty simple. I don't mean basic (funny, considering I did do quite a
bit of Visual Basic development in the beginning), I mean simple: there were few options and those options that
were available were generally dictated to developers via company policy and prescribed OS builds.

Jump forward to now and the options for developer tooling are pretty much endless. This is a good thing, it has enabled
developers to find their own individual magical setup to be as productive as possible. Editors and IDEs are a good
example. The [Vim][] vs [Emacs][] debate will likely never go away, but it definitely feels quieter than ever before
because it doesn't matter so much. I didn't think I would ever move away from [Vim][], but nowadays I'm a [VS Code][]
convert. I also have colleagues that prefer to work in [Goland by Jetbrains][].

Beyond the IDE is where things get interesting. How do we ensure consistency in our codebase in the face of (even
slightly) different IDE behaviour? In the Go world, where code generation is prevalent, how do we ensure that we don't
continually get conflicting generated code? How do we handle different OSes (Linux vs macOS) and variants, which bring
along different versions and variants of common tooling (e.g. `sed`, `bash`, etc)? How do we ensure that developers have
a way to reproduce locally any issues that may arise in CI?

How do we reduce the friction that freedom of choice introduces while still enabling developers to use their choice of
environment in order to be as productive as possible?

While there is no utopia, I feel like we've landed in a pretty good place right now (always room for improvement!) and I
wanted to share some of the things we've learned along the way. Let's work through a simple example that goes from where
we began to where we are now.

## (Contrived) Example project

We're going to build a very simple `go` project:

```go
package main

import "fmt"

func main() {
	fmt.Println("Hello, lovely person")
}
```

All this project needs is `go` to build. So how to install that?

## First try: manual install

Each developer has to install `go` themselves so they go to <https://go.dev/dl/>, download it, unpack it, and then can
run:

```bash
go build main.go
```

Of course this works perfectly :).

But what happens for a more involved go project that uses specific language features (e.g. generics requiring a minimum
of go 1.18)? What if different projects require different versions of go (e.g. [Docker client issues with go 1.20.6][])?
It's too much overhead for developers to manage multiple versions of go and configure them appropriately for each
project.

Then consider that for most projects there are multiple tools to manage. In a Kubernetes controller project there are
multiple tools simply for code generation (e.g. [`controller-gen`][controller-gen]), for packaging and deployment (e.g.
[`helm`][helm]), and for running clusters locally (e.g. [`kind`][kind]). It's just not sustainable to ask developers to
manually manage these.

We need a way to declare what tools are necessary for a project and have them automatically installed and configured.

## Second try: `make` targets

Instead of installing `go` manually, we can add a `make` target (presuming we're using `make` of course). As a very
basic recipe we can use something like:

```make
export PATH := $(CURDIR)/.local/go.bin:$(PATH)

.PHONY: install-go
install-go:
	rm -rf .local/go
	mkdir -p .local
	curl -fsSL https://go.dev/dl/go1.20.6.linux-amd64.tar.gz | tar -C .local -xz
```

Running `make install-go` downloads go, unpacks it, and adds the `go/bin` directory to the `PATH` so it can be used
easily in any other targets.

Go is unpacked into its own directory to keep the project self-contained, but would lead to multiple go installations,
one per project. One benefit of that is that it allows each project to use its required version of Go, but with a
trade-off of wasted disk space. We also need to manage different OSes and architectures, especially with macOS being so
popular and Apple Silicon being arm64.

The `Makefile` would grow for each tool required as each tool has different ways to unpack or install, different paths,
etc. The `Makefile` becomes pretty heavy just to install some tools. We can do better than that.

## Third try: [`asdf`][asdf]

[`asdf`][asdf] is a extensible tool that enables management of multiple versions of tools. Versions of tools are defined
in a single file [`.tool-versions`][tool-versions file] at the root of your project. Installation is simple, see the
[asdf installation docs][].

After installing `asdf`, we need to install the `go` plugin:

```bash
asdf plugin add golang
```

We can then search what versions are available:

```bash
$ asdf list all golang | tail -5
1.20.5
1.20.6
1.21rc1
1.21rc2
1.21rc3
```

And install a specific version (you can also use `latest` which is a nice feature):

```bash
asdf install golang 1.20.6
```

That makes the specific golang version available for any project to use, but each project still needs to declare what
version it wants to use:

```bash
asdf local golang 1.20.6
```

This updates the `.tool-versions` file with the specified version:

```bash
$ cat .tool-versions
cat .tool-versions
golang 1.20.6
```

And if you installed asdf successfully above, you can now see that the specified `go` version is available:

```bash
$ go version
go version go1.20.6 linux/amd64
```

You can repeat this for any tool that you require and `asdf` will configure your shell for you.

This is nice: each project has its own self-contained build environment, set up via the `PATH` pointing to a shared
cache of installed tools. There is no wasted disk space for multiple installations. Pretty nice.

But one thing still caused us headaches: differences in core CLI tooling between macOS and Linux. As we expand our
`Makefile`, it's pretty common for core CLI tools such as `sed` or `grep` to be used. Honestly I can't remember a
project that hasn't used these extremely convenient and powerful CLI tools.

Let's take `sed` as an example, and use it to update a file in-place. We add a target to our `Makefile`:

```make
.PHONY: update-greeting
update-greeting:
	sed -i "s/\(Hello, lovely person\)[^\"]\+/\1 at $$(date)/" main.go
```

Again, a contrived example to highlight the point. Run this on Linux: it works! Run this on macOS: it doesn't work...
The `-i` flag is different and needs to be handled differently.

We can add some other stuff to the `Makefile` such as:

```make
OS := $(shell uname)
ifeq ($(OS),Darwin)
SEDI := sed -i ''
else
SEDI := sed -i
endif

.PHONY: update-greeting
update-greeting:
	$(SEDI) "s/\(Hello, lovely person\)[^\"]\+/\1 at $$(date)/" main.go
```

Better, but there are many such differences, even down to the `bash` version, which is important as again most projects
I've worked on use `bash` scripts for repeated tasks, and different versions of `bash` have different capabilities. Who
wants to keep writing for the lowest common denominator? It's error prone and tedious.

We could use `brew` to install these OS tools, and indeed we have done that, but again it is a barrier to entry and puts
the responsibility on each individual developer to have the right tooling available for each project.

## Enter the (current) utopia: [Devbox][]

At the time of writing this I haven't yet convinced my colleagues of this, and I hope that this blog post goes some way
to help with that!

[Devbox][] describes itself as `Portable, Isolated Dev Environments on any Machine`. Exactly what we've been looking
for! Devbox is powered by [Nix][], a cross-platform functional package manager.

[Installing Devbox][] is nice and simple:

```bash
curl -fsSL https://get.jetpack.io/devbox | bash
```

We can then initialize the project as a `devbox` project via:

```bash
devbox init
```

Because Devbox is powered by Nix, you have access to all [packages][] available via Nix. Devbox provides a useful CLI to
search for packages:

```bash
$ devbox search go
Found 92+ results for "go":

* go  (1.20.5, 1.20.4, 1.20.3, 1.20.2, 1.20.1, 1.20, 1.20rc3, 1.20rc2, 1.20rc1, 1.19.10)
* goa  (3.11.3, 3.11.2, 3.11.0, 3.10.2, 3.10.0, 3.7.6, 1.4.1)
* gom  (0.4)
* got  (0.90, 0.88, 0.87, 0.86, 0.83, 0.82, 0.81, 0.79, 0.78, 0.77)
* gox  (1.0.1)
* gob2  (2.0.20)
* gocr  (0.52)
* goda  (0.5.7, 0.5.6, 0.5.5, 0.5.4, 0.5.3, 0.5.2, 0.5.1)
* godu  (1.4.1, 1.3.0)
* gof5  (0.1.4)
```

At the time of writing, go 1.20.6 is also out so the list of packages isn't always completely up to date, but the latest
version of packages are usually available before not too long.

We can then add a package to our project:

```bash
$ devbox add go@latest

Installing package: go.

[1/1] go@latest
[1/1] go@latest: Success
```

Looking at the `devbox.json` file we can see what's happened:

```json
{
  "packages": [
    "go@latest"
  ],
  "shell": {
    "init_hook": [
      "echo 'Welcome to devbox!' > /dev/null"
    ],
    "scripts": {
      "test": [
        "echo \"Error: no test specified\" && exit 1"
      ]
    }
  }
}
```

Let's check the go that we've just installed:

```bash
$ go version
zsh: command not found: go
```

Wait - command not found? But we installed it. Aha: we didn't start a shell with Devbox packages available.

```bash
$ devbox shell
Starting a devbox shell...
(devbox)
$ go version
go version go1.20.5 linux/amd64
(devbox)
```

It works! If we need a specific version of a package we can pin it by setting the version in the `devbox.json` file.
First, see what versions are available:

```bash
$ devbox search go
Found 92+ results for "go":

* go  (1.20.5, 1.20.4, 1.20.3, 1.20.2, 1.20.1, 1.20, 1.20rc3, 1.20rc2, 1.20rc1, 1.19.10)
* goa  (3.11.3, 3.11.2, 3.11.0, 3.10.2, 3.10.0, 3.7.6, 1.4.1)
* gom  (0.4)
* got  (0.90, 0.88, 0.87, 0.86, 0.83, 0.82, 0.81, 0.79, 0.78, 0.77)
* gox  (1.0.1)
* gob2  (2.0.20)
* gocr  (0.52)
* goda  (0.5.7, 0.5.6, 0.5.5, 0.5.4, 0.5.3, 0.5.2, 0.5.1)
* godu  (1.4.1, 1.3.0)
* gof5  (0.1.4)
```

To pin to version `1.19.10` for example, we can change the `devbox.json` file to look like this:

```json
{
  "packages": [
    "go@1.19.10"
  ]
}
```

How is this any better than using `asdf` above? We can manage OS tooling too, in an isolated, reproducible
way! Let's use `sed` as an example:

```bash
$ devbox search gnused
Found 2+ results for "gnused":

* gnused  (4.9, 4.8)
* gnused_422  (4.2.2)
```

And add it:

```bash
$ devbox add gnused

Installing package: gnused@latest.

[1/1] gnused@latest
[1/1] gnused@latest: Success
```

Now we can drop the cross-platform Makefile hacks we added above and know that developers using Devbox will have the
same version of `sed` available, regardless of the OS they are running on.

Doing the same for `bash`:

```bash
$ devbox add bash

Installing package: bash@latest.

[1/1] bash@latest
[1/1] bash@latest: Success
```

Devbox allows us to manage both developer tools and OS tools to build a consistent environment across platforms.

Running `devbox shell` every time you switch to a project can get tedious quickly so Devbox integrates with the widely
adopted [`direnv`][direnv] to set up your shell automatically when changing into your project directory in your
terminal. See [here][devbox direnv] for more details.

Devbox also integrates very nicely with [GitHub Actions][] via the [Devbox install action][]:

```yaml
name: Testing with devbox

on: push

jobs:
  test:
    runs-on: ubuntu-22.04
    steps:
      - uses: actions/checkout@v3

      - name: Install devbox
        uses: jetpack-io/devbox-install-action@v0.4.0

      - name: Run arbitrary commands
        run: devbox run -- go version"
```

This configures devbox and nix, and caches the package installation to speed up subsequent runs. The additional `devbox
run --` prefix to commands is a little annoying, but I haven't yet figured out how to avoid that.

## Conclusion

[Devbox][] has considerably simplified a number of my project's build systems. I'm yet to explore some of it's other
features, including [integration with VS Code][] and [OCI image creation][]. I'm excited by the possibilities!

[controller-gen]: https://book.kubebuilder.io/reference/controller-gen.html
[helm]: https://helm.sh/
[kind]: https://kind.sigs.k8s.io/
[asdf]: https://asdf-vm.com/
[tool-versions file]: https://asdf-vm.com/manage/configuration.html#tool-versions
[asdf installation docs]: https://asdf-vm.com/guide/getting-started.html
[Devbox]: https://www.jetpack.io/devbox/
[Nix]: https://nixos.org/
[Installing Devbox]: https://www.jetpack.io/devbox/docs/quickstart/#install-devbox
[direnv]: https://direnv.net/
[devbox direnv]: https://www.jetpack.io/devbox/docs/ide_configuration/direnv/
[GitHub Actions]: https://docs.github.com/en/actions
[Devbox install action]: https://github.com/jetpack-io/devbox-install-action
[OCI image creation]: https://www.jetpack.io/devbox/docs/cli_reference/devbox_generate_dockerfile/
[integration with VS Code]: https://www.jetpack.io/devbox/docs/ide_configuration/vscode/
[Goland by Jetbrains]: https://www.jetbrains.com/go/
[Vim]: https://www.vim.org/
[Emacs]: https://www.gnu.org/software/emacs/
[VS Code]: https://code.visualstudio.com/
[packages]: https://search.nixos.org/packages
[Docker client issues with go 1.20.6]: https://github.com/moby/moby/issues/45935
