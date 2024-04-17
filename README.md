# D2iQ Engineering Blog

![D2iQ Engineering Blog license](https://img.shields.io/github/license/mesosphere/d2iq-engineering-blog)

This blog is brought to you by the engineers of [D2iQ][d2iq]. This is a place for D2iQ engineers to share our knowledge
and experiences, a place for us all to dive deep into Kubernetes, how to solve problems, and Smart Cloud Native app
development. Come along for the ride!

All content in this blog is published under the
[Creative Commons Attribution-ShareAlike 4.0 International (`CC BY-SA 4.0`)][CC BY-SA 4.0] license.

## Proposing a new blog post

If you have an idea for a blog post, either something you would like to read about or would like to write yourself,
please submit a [GitHub issue][issues]. Please add a description, any questions you would like answered, and any
pointers to other content that may prove supportive or useful in creating the blog post.

No proposal too big or too small! If the proposal is big, then it might be best to create a series of blog posts that
build on top of one another.

## Contributing new content

Please follow the standard GitHub pull request process:

1. [Fork the repository][forking]
1. [Clone your forked repository][cloning a fork]
1. [Add new content][add content] (also see [here](#add-a-new-post))
1. [Open a pull request][open pr]

Follow the instructions below to create and preview your new content.

### Install required tools

Using [Devbox][] is highly recommended. Follow [these instructions][devbox installation] to install [Devbox][] and
install [direnv][] for shell integration - this is the simplest way to get started. 

### Add a new post

To create a new post, run:

```shell
hugo new --kind post-bundle posts/<name>
```

Note that `<name>` should be a directory path and the title of the post will be derived from it. As an example:

```bash
$ hugo new --kind post-bundle posts/a-new-post
Content dir "content/posts/a-new-post" created


$ ls content/posts/a-new-post/
feature.png  index.md

$ cat content/posts/a-new-post/index.md
---
authors: ["ADD AUTHOR NAME"]
title: "A New Post"
date: 2022-08-24T16:31:50+01:00
tags: []
excerpt: ADD EXCERPT HERE
feature_image: feature.png
---

Some content...
```

Now you can edit the file `content/posts/a-new-post/index.md` to add your content.

### Add a new page

To create a new page, run:

```shell
hugo new --kind page-bundle <name>
```

Note that `<name>` should be a directory path and the title of the page will be derived from it. As an example:

```bash
$ hugo new --kind page-bundle some/new/page
Content dir "content/some/new/page" created


$ ls content/some/new/page/
feature.png  _index.md

$ cat content/some/new/page/_index.md
---
title: "A New Post"
date: 2022-08-24T16:31:50+01:00
tags: []
excerpt: ADD EXCERPT HERE
feature_image: feature.png
---

Some content...
```

Now you can edit the file `content/some/new/page/_index.md` to add your content.

### Preview your content locally

If you are using [Devbox][] then run:

```shell
devbox run serve
```

Alternatively, run [hugo][], passing `-D -F` to show drafts and posts with future publication dates (this is equivalent
to the above Devbox command):

```shell
hugo serve -D -F
```

Then open your browser and go to [https://localhost:1313](https://localhost:1313). Your post will be updated any time
you edit the content.

### Preview your content after deployment

Once you have [added and pushed][add content] your content and [opened a pull reqeust][open pr], you will be able to
preview the deployment at
https://deploy-preview-\<PR NUMBER>--d2iq-engineering.netlify.app/.

## Hosting

The D2iQ engineering blog is currently hosted on [Netlify][netlify] but is fronted [AWS CloudFront][cloudfront] in order to provide a custom domain ([https://eng.d2iq.com/][eng blog]).

[CC BY-SA 4.0]: https://creativecommons.org/licenses/by-sa/4.0/
[d2iq]: https://d2iq.com/
[issues]: https://github.com/mesosphere/d2iq-engineering-blog/issues/
[forking]: https://docs.github.com/en/get-started/quickstart/contributing-to-projects#forking-a-repository
[cloning a fork]: https://docs.github.com/en/get-started/quickstart/contributing-to-projects#cloning-a-fork
[add content]: https://docs.github.com/en/get-started/quickstart/contributing-to-projects#making-and-pushing-changes
[open pr]: https://docs.github.com/en/get-started/quickstart/contributing-to-projects#making-a-pull-request
[hugo]: https://gohugo.io/
[hugo install]: https://gohugo.io/getting-started/installing
[netlify]: https://netlify.com/
[cloudfront]: https://aws.amazon.com/cloudfront/
[eng blog]: https://eng.d2iq.com/
[Devbox]: https://www.jetify.com/devbox/
[devbox installation]: https://www.jetify.com/devbox/docs/contributor-quickstart/#install-devbox
[direnv]: https://direnv.net/
