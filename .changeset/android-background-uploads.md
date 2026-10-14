---
mobile: minor
core: patch
---

On Android, turning on Upload in the background in the menu keeps uploads going on Wi-Fi with the app in the background or the phone locked, with a notification while they run. `UploadManager.shardBytes` reports bytes sent to hosts as a file uploads, and the suspension manager gains `suspendUnlessBusy`, which suspends only when no background task is running.
