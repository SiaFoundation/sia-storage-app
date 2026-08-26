---
applyTo: 'apps/integration/**'
---

# Integration tests

Real `AppService` instances over a shared `MockIndexerStorage`. A test that skips the
app's own code paths passes while the product stays broken, so:

- Create files with the test app's `addFiles()`.
- Trash and delete through the facade: `app.files.trashFile`,
  `app.files.tombstoneFile`, `app.files.tombstoneWithThumbnailsAndCleanup`. Never
  write `trashedAt` or `deletedAt` into the database directly.
- Let sync run on its own 200ms interval and wait with `waitForCondition()`. Forcing a
  tick hides the races these tests exist to catch.
- `app.sdk.injectObject()` writes straight to the mock indexer and skips upload. Use it
  only to stand up state another device already published, never to create the files
  under test.
