---
core: patch
logger: patch
mobile: patch
---

Made the log appender's stop non-blocking and moved scheduler pause/abort before suspend pre-work, so iOS suspension no longer stalls on a DB flush behind still-ticking services.
