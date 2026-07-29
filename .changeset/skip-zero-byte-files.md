---
core: patch
mobile: patch
---

Zero-byte files no longer stall uploads: imports refuse them with an "empty file" reason, and already-imported ones are marked lost instead of retrying forever.
