---
mobile: patch
core: patch
---

Pause uploads and the photo import scanner while the initial library sync is in progress, so sync-down isn't competing with the upload pipeline for the JS thread and the database.
