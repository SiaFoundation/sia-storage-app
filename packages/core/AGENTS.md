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
- A device has up to two places for a file's bytes. The cache is this app's own
  folder, recorded in `fs` with one row per version. The mount is the folder a file
  manager shows, where the operating system keeps its own copy, recorded in
  `mount_copies` with one row per file. A version waiting to upload is always in the
  cache, since the uploader reads nothing else. Code that asks whether a file is on the
  device reads both.
- The Rust port in `crates/sia-storage-core` matches the SQLite schema and the indexer
  wire format byte for byte. A schema or encoding change here that is not mirrored
  there breaks cross-client sync.
