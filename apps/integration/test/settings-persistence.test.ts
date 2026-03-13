import { createEmptyIndexerStorage } from '@siastorage/sdk-mock'
import { createTestApp, type TestApp } from './app'

describe('Settings Persistence', () => {
  let app: TestApp

  beforeEach(async () => {
    app = createTestApp(createEmptyIndexerStorage())
    await app.start()
  })

  afterEach(async () => {
    await app.shutdown()
  })

  it('boolean settings persist', async () => {
    await app.app.settings.setHasOnboarded(true)
    const value = await app.app.settings.getHasOnboarded()
    expect(value).toBe(true)
  })

  it('number settings persist', async () => {
    await app.app.settings.setMaxDownloads(5)
    const value = await app.app.settings.getMaxDownloads()
    expect(value).toBe(5)
  })

  it('string settings persist', async () => {
    await app.app.settings.setIndexerURL('https://example.com')
    const value = await app.app.settings.getIndexerURL()
    expect(value).toBe('https://example.com')
  })

  it('JSON settings persist', async () => {
    await app.app.settings.setViewSettings({ layout: 'grid', sort: 'name' })
    const value = await app.app.settings.getViewSettings()
    expect(value).toEqual({ layout: 'grid', sort: 'name' })
  })

  it('array settings persist', async () => {
    await app.app.settings.setLogScopes(['sync', 'upload'])
    const value = await app.app.settings.getLogScopes()
    expect(value).toEqual(['sync', 'upload'])
  })
})
