---
core: minor
---

Uploads pass a file path to the SDK instead of reading the file and pushing chunks across the FFI boundary. `UploaderAdapters.createFileReader` becomes `toFilePath`, and `PackedUploadRef.add` becomes `addPath`.
