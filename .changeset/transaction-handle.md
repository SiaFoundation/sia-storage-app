---
core: patch
---

`withTransactionAsync` passes its body a handle bound to the transaction, and `internal.withTransaction` passes a database facade bound to it. A body must reach the database only through that handle, and using the outer adapter inside one throws `TransactionMisuseError` on node.
