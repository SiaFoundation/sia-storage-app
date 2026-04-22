---
mobile: patch
---

Library status sheet now opens with a one-line activity indicator ("Online and synced", "Syncing metadata from indexer", "Uploading files", etc.) driven by the same hook as the toolbar status pill. Connectivity issues surface inline on that row with a Reconnect shortcut when the indexer is unreachable, replacing the separate banner. The redundant Sync metadata section has been removed.
