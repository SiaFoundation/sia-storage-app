---
mobile: minor
---

Split "Reset application" into two actions: `resetLocalDataAndResync` keeps the user signed in and re-downloads their library from the indexer, and `resetLocalDataAndSignOut` wipes everything and returns to onboarding.
