---
mobile: patch
---

Cache eviction during background tasks now waits 30 seconds before starting and runs only inside the longer iOS background processing task — the 30-second app-refresh wake stays focused on upload polling, and the longer wake gives the upload manager time to spin up before the scanner competes for the JS thread and database.
