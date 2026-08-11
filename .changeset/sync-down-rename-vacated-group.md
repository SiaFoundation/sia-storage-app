---
core: patch
---

Sync-down and upsertManyFiles now recalculate the version group a rename vacates, so a renamed stack can no longer leave its old group without a current version.
