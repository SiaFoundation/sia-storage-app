---
mobile: patch
core: patch
---

Tightened the iOS background-suspension cleanup budget and added a self-deadline to background tasks so cleanup completes inside the task's allotted wake window instead of racing iOS's expiration callback.
