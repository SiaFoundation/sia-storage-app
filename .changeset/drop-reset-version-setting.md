---
core: minor
---

Removed `settings.getCompletedResetVersion` and `settings.setCompletedResetVersion`. The forced-reset marker is per build variant and now lives in `app.storage` alongside the platform's other cursors.
