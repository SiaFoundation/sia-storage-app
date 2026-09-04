---
applyTo: 'packages/core/**'
---

# Shared TS core

- The AppService facade in `src/app/` is the only surface platform apps call. New
  capability is exposed by adding to a namespace under `src/app/namespaces/`, not by
  widening what apps may import.
- DB operations live in `src/db/operations/`, take `(db, ...args)` as their first
  parameter, and are wrapped by the facade's `db` namespace. SQL belongs here and
  nowhere else.
- Export new surface through a specific subpath in `package.json` `exports`. Do not
  re-export across barrels, and do not leave a passthrough re-export behind after
  moving something.
- A change to upload, sync, import, trash, or delete behavior needs a test under
  `apps/integration/test/`. A unit test does not cover two devices disagreeing.
- The Rust port in `crates/sia-storage-core` matches the SQLite schema and the indexer
  wire format byte for byte. A schema or encoding change here that is not mirrored
  there breaks cross-client sync.
