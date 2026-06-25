---
core: patch
node-adapters: patch
---

Remove the `maxInflight` transfer-concurrency option from the SDK adapter and the `DOWNLOAD_MAX_INFLIGHT`/`UPLOAD_MAX_INFLIGHT` config constants. Transfer concurrency is now managed by the SDK.
