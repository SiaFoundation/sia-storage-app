---
core: patch
---

Fix the import scanner re-selecting `lostReason`-marked placeholders on every tick, which caused a cascade of library-cache invalidations. `FileQueryOpts` gains a `lostReasonIsNull` flag used by the scanner's phase 2 query; successful finalize clears `lostReason` so a recovered row can leave the Unavailable tab.
