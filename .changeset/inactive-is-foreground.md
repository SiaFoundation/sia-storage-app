---
mobile: patch
core: patch
---

Treat iOS `inactive` AppState as a foreground sub-state (per Apple's docs) so SWR data fetches keep running through transient interruptions like notification banners and Face ID prompts instead of pausing.
