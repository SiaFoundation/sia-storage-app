---
mobile: patch
core: patch
---

Fixed iOS RunningBoard 0xDEAD10CC crashes by releasing the background-task assertion before the suspension wind-down, and removed the now-unused DB drain/close pipeline (DELETE-mode SQLite handles uncleanly-suspended connections without intervention).
