# Core Testing

## Philosophy

These tests boot the **entire app** and let services run **naturally with real timers**. The goal is high-confidence testing that mirrors actual app behavior.

If these tests pass, the app works end-to-end up to rendering.

**Key Principle: As Real As Possible**

- Mocks should mimic real behavior exactly, not simplify for convenience
- Use real temp directories with actual files on disk
- Use real images (PNGs, JPEGs) so thumbnails generate correctly
- All app features (thumbnails, sync, uploads) should work in tests
- If something fails in tests, fix the mock to be more realistic, not the test

## Design Constraints

### 1. Run the Whole App Naturally

Call `initApp()` which starts ALL services with real timers:
- Upload scanner: 1 second (test config)
- Sync down events: 2 seconds (test config)
- Sync up metadata: 2 seconds (test config)
- Thumbnail scanner: 1 second (test config)

**Do NOT mock or fake timers.** The point is to verify the real timing and coordination works.

### 2. No Manual Triggering

**NEVER call internal methods like `manager.flush()`, `syncDownEvents()`, or `runSyncUpMetadata()`.**

Wait for the app to naturally reach the expected state:
```typescript
// WRONG - manually triggering
await syncDownEvents()
expect(files).toHaveLength(5)

// RIGHT - wait for natural service execution
await waitForCondition(
  async () => (await readAllFileRecords()).length === 5,
  { timeout: 10_000, message: 'Files to sync' }
)
```

The app has automatic triggers that should fire naturally:
- **Slab threshold**: Flush when slab reaches 90% full
- **Idle timeout**: Flush after idle period with no new files
- **Service intervals**: Sync, thumbnails, and scanning run on configured intervals

If tests need manual triggers to pass, the app's automatic behavior is broken.

### 3. Real Files and Real Behavior

**Use real image files, not random bytes:**
```typescript
// WRONG - random bytes won't generate thumbnails
generateTestFiles(3, { sizeBytes: 1024 })

// RIGHT - real images work with thumbnails
generateTestFilesFromAssets(TEST_ASSETS_DIR, [
  'test-image-1.png',
  'test-image-2.png',
])
```

**Thumbnails are real:** When you upload an image, thumbnail generation runs. Tests should account for this - don't filter them out, expect them.

**File operations are real:** The `nodeFileSystem.ts` mock uses Node's `fs` module with real temp directories. Files exist on disk.

### 4. Assert on UI-Visible State

Use the same stores and hooks the UI uses:
- `getUploadState(fileId)` → `{ status, progress, batchId, batchFileCount }`
- `getUploadCounts()` → `{ total, totalActive, totalQueued }`
- `getActiveUploads()` → `UploadState[]`

This ensures we're testing what the user actually sees.

### 5. Test State Transitions

Watch uploads progress through all states:
```
queued → packing → packed → uploading → (removed on success)
```

### 6. Mocks Must Be Realistic

When a mock is incomplete and causes errors:
- **DO:** Fix the mock to implement the missing behavior
- **DON'T:** Suppress errors or add filters to hide the problem

Example: If thumbnail generation fails because `File.copy()` isn't implemented, implement it in `nodeFileSystem.ts`, don't suppress thumbnail errors.

## Architecture

### App Boot (`src/stores/app.ts`)

`initApp()` runs: prepare → migrations → connect → services

The services step starts all background intervals.

### Upload Flow (`src/managers/uploader.ts`)

1. Scanner finds "local only" files
2. Files stream into packer (slab batching)
3. **Automatic flush triggers**:
   - Slab ≥90% full AND next file crosses boundary
   - Idle timeout: 5 seconds with no new files
4. Upload completes, state removed from store

### Service Intervals (`src/lib/serviceInterval.ts`)

All services support pause/resume and use real `setInterval`/`setTimeout`.

## File Structure

```
test/
├── core/
│   ├── harness.ts       # Full app boot, lifecycle control
│   ├── mockSdk.ts       # In-memory SDK implementation
│   ├── testHelpers.ts   # File generators, utilities
│   └── waitFor.ts       # Polling utilities
├── mocks/               # Native module mocks
├── integration/
│   ├── setup.ts         # Common mock configuration
│   ├── appBoot.test.ts  # App initialization
│   ├── uploadFlow.test.ts
│   ├── slabBatching.test.ts
│   ├── stateTransitions.test.ts
│   ├── syncDown.test.ts
│   └── connectivity.test.ts
└── README.md            # This file
```

## Running Tests

```bash
bun run test:core
```

## Debugging

When tests fail or time out, check:

1. **Are services running?** The harness has `areServicesRunning()` check.
2. **Is the scanner finding files?** Files need entries in both `files` and `fs` tables.
3. **Are timers firing?** Real timers should work - if not, something is blocking the event loop or mocking timers unexpectedly.

### Common Issues

- **Files not detected**: Scanner queries `getFilesLocalOnly()` which requires `fs` table entries
- **Uploads stuck at "packed"**: Idle timer not firing - check if Jest fake timers are enabled
- **Timeouts**: Remember scanner runs every 5s, flush waits 5s idle - budget 15-20s minimum

## What NOT to Do

- Don't use `jest.useFakeTimers()` - we need real timers
- Don't call `flush()`, `syncDownEvents()`, or other internal methods manually
- Don't skip the idle timeout by forcing flushes
- Don't mock the upload manager or service intervals
- Don't use random bytes when real images are needed
- Don't suppress errors to make tests pass - fix the underlying issue
- Don't filter out thumbnails or other real app behavior from assertions
- Don't add SDK helpers that don't exist in the real SDK

## Test Assets

Real test images are stored in `test/assets/`:
- `test-image-1.png`, `test-image-2.png`, etc.
- These are used by `generateTestFilesFromAssets()` for tests that need thumbnail generation
