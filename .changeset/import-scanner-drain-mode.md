---
'@siastorage/mobile': patch
---

Imports finish faster — the import scanner now drains pending hashes back-to-back instead of waiting 3 seconds between batches of 20.
