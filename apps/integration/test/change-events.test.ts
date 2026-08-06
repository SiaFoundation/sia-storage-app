import { createEmptyIndexerStorage } from '@siastorage/sdk-mock'
import type { ChangeScope } from '@siastorage/core/types'
import { createTestApp, generateTestFiles, type TestApp } from './app'

describe('Change events', () => {
  let app: TestApp
  let seen: ChangeScope[]
  let unsubscribe: () => void

  beforeEach(async () => {
    app = createTestApp(createEmptyIndexerStorage())
    await app.start()
    seen = []
    unsubscribe = app.internal.events.on((scope) => seen.push(scope))
  })

  afterEach(async () => {
    unsubscribe()
    await app.shutdown()
  })

  it('signals a library change when files are added', async () => {
    await app.addFiles(generateTestFiles(2, { startId: 1 }))

    await app.waitForCondition(() => seen.includes('library'), 5000)
  })

  it('signals a connection change when connectivity flips', async () => {
    app.setConnected(false)

    await app.waitForCondition(() => seen.includes('connection'), 5000)
  })

  it('coalesces a burst of library writes into far fewer signals than writes', async () => {
    await app.addFiles(generateTestFiles(20, { startId: 100 }))

    await app.waitForCondition(() => seen.includes('library'), 5000)
    expect(seen.filter((s) => s === 'library').length).toBeLessThan(20)
  })

  it('stops signalling after the listener unsubscribes', async () => {
    unsubscribe()
    // A second listener gives the assertion something to wait on, so the test
    // proves the first one went quiet rather than that it merely ran early.
    const stillListening: ChangeScope[] = []
    const off = app.internal.events.on((scope) => stillListening.push(scope))

    await app.addFiles(generateTestFiles(1, { startId: 200 }))
    await app.waitForCondition(() => stillListening.includes('library'), 5000)
    off()

    expect(seen).toEqual([])
  })
})
