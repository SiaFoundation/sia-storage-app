---
core: patch
---

Adds `@siastorage/core/lib/ipcEndpoint`, which says where a daemon socket is reached, and on Windows names the daemon's pipe at random and has a client check the daemon's secret before sending anything.
