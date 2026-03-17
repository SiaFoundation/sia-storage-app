import { createEmptyIndexerStorage } from '@siastorage/sdk-mock'
import { createTestApp, type TestApp } from './app'

describe('App Boot', () => {
  let app: TestApp

  beforeEach(() => {
    app = createTestApp(createEmptyIndexerStorage())
  })

  afterEach(async () => {
    await app.shutdown()
  })

  it('boots app and starts all services', async () => {
    await app.start()

    expect(app.areServicesRunning()).toBe(true)
    expect(app.sdk.isConnected()).toBe(true)
  })

  it('initializes database on start', async () => {
    await app.start()

    const files = await app.getFiles()
    expect(Array.isArray(files)).toBe(true)
    expect(files.length).toBe(0)
  })

  it('supports pause and resume of services', async () => {
    await app.start()

    expect(app.areServicesRunning()).toBe(true)

    app.pause()
    expect(app.areServicesRunning()).toBe(false)

    app.resume()
    expect(app.areServicesRunning()).toBe(true)
  })

  it('cleans up properly on shutdown', async () => {
    await app.start()

    expect(app.areServicesRunning()).toBe(true)
    expect(app.getActiveUploadCount()).toBe(0)

    await app.shutdown()

    expect(app.sdk.getStoredObjects().length).toBe(0)
  })
})
