/**
 * App Boot Integration Test
 *
 * Verifies the app boots correctly and services start.
 */

import './utils/setup'

import { type AppCoreHarness, createHarness } from './utils/harness'

describe('App Boot Integration', () => {
  let harness: AppCoreHarness

  beforeEach(async () => {
    harness = createHarness()
  })

  afterEach(async () => {
    await harness.shutdown()
  })

  it('boots app and starts all services', async () => {
    await harness.start()

    // Services should be running (not paused)
    expect(harness.areServicesRunning()).toBe(true)

    // SDK should be connected
    expect(harness.sdk.isConnected()).toBe(true)
  })

  it('initializes database on start', async () => {
    await harness.start()

    // Should be able to get files (database initialized)
    const files = await harness.getFiles()
    expect(Array.isArray(files)).toBe(true)
    expect(files.length).toBe(0)
  })

  it('supports pause and resume of services', async () => {
    await harness.start()

    expect(harness.areServicesRunning()).toBe(true)

    harness.pause()
    expect(harness.areServicesRunning()).toBe(false)

    harness.resume()
    expect(harness.areServicesRunning()).toBe(true)
  })

  it('cleans up properly on shutdown', async () => {
    await harness.start()

    expect(harness.areServicesRunning()).toBe(true)
    expect(harness.getActiveUploadCount()).toBe(0)

    await harness.shutdown()

    // After shutdown, SDK should be disconnected
    // (harness resets SDK state)
    expect(harness.sdk.getStoredObjects().length).toBe(0)
  })
})
