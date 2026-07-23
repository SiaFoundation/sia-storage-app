---
core: minor
---

Add the `imports` and `import_files` tables that track in-flight imports in place of `hash=''` placeholder file rows; the migration rehomes existing placeholder rows under a legacy import and adds `files.mediaAssetId`.
