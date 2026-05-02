---
mobile: patch
---

Reduced background CPU usage on iOS by deferring import, orphan, eviction, and photo archive scans during BGAppRefreshTask wakes (where iOS still enforces the 80%-CPU-over-60s monitor with no requiresExternalPower opt-out); they still run during longer BGProcessingTask wakes.
