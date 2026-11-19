---
core: patch
---

`app.provider` takes a Windows handoff path, written with either separator and in any letter case. It read paths with forward slashes only, and refused every path a Windows integration named.
