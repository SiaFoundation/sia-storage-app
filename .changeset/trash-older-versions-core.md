---
core: minor
---

Older versions of a file move to the Trash a day after a newer version replaces them on the device, once both have uploaded, and are deleted for good 30 days later like anything else in the Trash. A version restored from the Trash comes back as the current version. `app.shares.syncLinksAndTrashOlderVersions` runs the pass after listing the account's share links, and `app.files.trashOlderVersions` runs it without the listing.
