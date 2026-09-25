---
cli: patch
core: minor
---

`sia add` and `sia import` store file hashes in the same `sha256:` form as every other app, so saving identical bytes over a file added with the CLI no longer creates a duplicate version and `sia import --skip-existing` finds files added elsewhere. `FileMetadata.hash` is typed `ContentHash` from `@siastorage/core/lib/contentHash`, built with `toContentHash`, and decoded metadata and stored files with a bare hex hash gain the prefix.
