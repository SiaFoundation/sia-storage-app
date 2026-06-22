/**
 * Auto-prune: a background service periodically calls the indexer's prune
 * endpoint to reclaim storage left behind by deleted files. It doesn't try to
 * detect reclaimable storage first — the indexer does that as prune's first
 * step — so the service just calls prune when connected.
 */

import { runPruneSlabs } from '@siastorage/core/services/pruneSlabs'
import { createEmptyIndexerStorage } from '@siastorage/sdk-mock'
import { createTestApp, type TestApp } from './app'

describe('Prune slabs', () => {
  let app: TestApp

  beforeEach(async () => {
    app = createTestApp(createEmptyIndexerStorage())
    await app.start()
  })

  afterEach(async () => {
    await app.shutdown()
  })

  it('calls the prune endpoint when connected', async () => {
    await runPruneSlabs(app.app, app.internal)
    expect(app.sdk.pruneSlabsCallCount).toBe(1)
  })

  it('does not call prune when disconnected', async () => {
    app.setConnected(false)
    await runPruneSlabs(app.app, app.internal)
    expect(app.sdk.pruneSlabsCallCount).toBe(0)
  })
})
