---
core: minor
---

Removes `app.db.waitUntilActive` and `DatabaseAdapter.waitUntilActive`. An adapter with a suspension gate holds a new call until the gate reopens and rejects a statement inside a transaction that was already open once a grace period has passed, and the optional `DatabaseAdapter.failFast()` returns a view of it that rejects instead of holding. The suspension manager takes a `suspendBlocker` hook and an optional `db.isInTransaction` check, and `Mutex.tryAcquire()` takes a free lock in the calling tick.
