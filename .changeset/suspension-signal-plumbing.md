---
core: patch
---

Scheduler-driven services that hold a DB handle now accept an AbortSignal so workers exit at loop boundaries before the suspension gate closes.
