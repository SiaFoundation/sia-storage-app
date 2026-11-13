---
core: minor
---

`provider.fetchRange` takes the content version the system asked for and a `strict` flag, and returns the item for the version it served. With `strict` it rejects when that version is no longer the current one.
