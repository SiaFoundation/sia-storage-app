---
core: patch
mobile: patch
---

Recognize files by their magic bytes instead of trusting a misleading filename extension, so a `.heic`-named file that's actually JPEG is identified as JPEG everywhere `type` is surfaced.
