---
core: patch
---

`app.provider` takes a Windows handoff path, written with either separator and either case of drive letter. It read paths with forward slashes only, and refused every path a Windows integration named.
