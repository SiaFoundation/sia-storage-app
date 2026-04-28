---
core: patch
---

Resolve directories and tags in bulk during sync-down, replacing per-row lookups with a single SELECT and a bulk INSERT OR IGNORE per batch. Significantly speeds up large initial syncs.
