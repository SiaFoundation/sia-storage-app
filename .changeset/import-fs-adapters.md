---
core: minor
---

Add `fs` facade methods `removeFileByPath`, `getDeviceSpace`, and `importCopy` (the import scanner's claim-scoped copy, reading each source once with hash and progress reported from the copy, and a `move` option that consumes staged sources by rename), and exempt files referenced by in-flight `import_files` rows from the orphan sweep.
