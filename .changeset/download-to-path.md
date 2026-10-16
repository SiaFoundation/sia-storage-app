---
mobile: patch
core: patch
---

Downloads use less memory, since a large file is written straight to disk instead of passing through the app a piece at a time, and a download that is cancelled, as every download is when the app goes to the background, no longer leaves part of the file marked as on the phone. `DownloadLikeRef` gains an optional `writeToPath`, and `fileUriToPath` returns a path with a literal `%` as it is instead of throwing.
