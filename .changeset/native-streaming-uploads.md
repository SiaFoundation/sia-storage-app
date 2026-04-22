---
mobile: patch
---

Mobile uploads now use the platform's native `ReadableStream` with a BYOB file reader instead of a JS polyfill.
