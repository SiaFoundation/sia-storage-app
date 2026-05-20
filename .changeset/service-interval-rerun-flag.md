---
'@siastorage/core': patch
---

`ServiceScheduler.triggerNow()` no longer drops requests that arrive while a tick is running — the request defers to fire immediately after the in-flight tick completes.
