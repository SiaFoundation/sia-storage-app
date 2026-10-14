---
core: minor
mobile: patch
cli: patch
---

Upload progress no longer counts files that can never upload, so it reaches complete once everything else has uploaded. `UploadCategoryStats.total` covers uploaded and remaining files only, and the new `unavailable` and `unavailableBytes` count files with no object on the indexer and no local copy, or marked lost. The phone's status sheet and `sia status` show those files separately.
