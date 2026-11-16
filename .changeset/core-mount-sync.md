---
core: minor
---

A host passes a `mount` adapter that lists the files the system holds in the mount, and each eviction pass corrects the `mount_copies` table from that list. `provider.mountChanged` lets an integration ask for an early read of it.
