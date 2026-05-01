---
core: patch
mobile: patch
---

Made the remote log forwarder's stop non-blocking and skipped its ticker entirely when no remote endpoint is configured, so iOS suspension no longer waits on an in-flight log POST.
