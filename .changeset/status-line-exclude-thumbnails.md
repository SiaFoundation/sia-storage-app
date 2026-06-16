---
'@siastorage/mobile': patch
'@siastorage/core': patch
---

Exclude thumbnails from the file count in the status line. "Encrypting N files" / "Uploading N files" / "Importing N files" now count only real files, not the thumbnails generated alongside them. Thumbnails still upload — when only thumbnails remain, the status line keeps showing the state without a number.
