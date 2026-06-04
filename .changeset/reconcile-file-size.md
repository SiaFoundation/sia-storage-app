---
core: patch
mobile: patch
---

File sizes now reflect the real file length. The size read at import is often wrong on Android; it's corrected to the real on-disk size after copy, then again from the size the SDK reports when the upload finishes, and any already-wrong sizes heal as files sync down.
