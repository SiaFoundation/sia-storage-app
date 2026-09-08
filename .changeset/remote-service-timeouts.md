---
core: minor
---

`createRemoteAppService` takes per-channel timeouts, and its `invoke` callback now receives `(channel, args, timeoutMs)` in place of variadic arguments.
