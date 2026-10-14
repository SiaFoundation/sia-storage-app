---
mobile: patch
desktop: patch
cli: patch
core: patch
---

Uploads and downloads share a memory budget sized from what the device can spare, instead of each taking a tenth of its total memory, and downloads keep part of it however large an upload is. `AppServiceAdapters.readMemory` supplies the reading.
