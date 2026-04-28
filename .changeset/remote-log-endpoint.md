---
mobile: patch
core: minor
logger: minor
---

Added optional log forwarding under Settings → Advanced — every log entry is sent as NDJSON to a user-supplied HTTP endpoint with optional Bearer auth, and resumes from a saved cursor after offline gaps.
