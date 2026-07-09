---
core: minor
---

Rename `FileRecord.localId` to `mediaAssetId`; the import scanner now claims, copies, and finalizes `import_files` rows into the files table, recording a reason code for every failure.
