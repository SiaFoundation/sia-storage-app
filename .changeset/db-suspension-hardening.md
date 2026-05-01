---
mobile: patch
core: patch
---

Fixed iOS background-transition crashes caused by races in SQLite handle teardown and query pile-up at the suspend boundary.
