---
core: patch
mobile: patch
desktop: patch
cli: patch
---

A file that fails to upload is tried again after a delay that grows with each failure, instead of over and over without a pause. A file that can't be read waits up to 30 minutes, a network failure up to 2 minutes, and every file is tried again as soon as the connection comes back.
