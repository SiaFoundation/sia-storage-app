import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { IpcConnection } from '@siastorage/node-adapters'
import type { CliApp } from '../../src/app'
import { buildHandlerMap } from '../../src/daemon/ipc/index'
import { createTestApp } from '../helpers'

/**
 * The cache settings and the on-request pass, called the way `sia config` and
 * the desktop app reach them: through the daemon's reflected socket channels.
 */
let tempDir: string
let app: CliApp
let call: (channel: string, ...args: unknown[]) => Promise<unknown>

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sia-cache-settings-'))
  app = await createTestApp(tempDir)
  const handlers = buildHandlerMap(app, () => {})
  call = (channel, ...args) => {
    const handler = handlers.get(channel)
    if (!handler) throw new Error(`No handler for ${channel}`)
    return handler({ args }, {} as IpcConnection)
  }
})

afterEach(() => {
  app.db.close?.()
  fs.rmSync(tempDir, { recursive: true, force: true })
})

describe('cache settings over the daemon socket', () => {
  it('defaults to a one-hour hold and stores another', async () => {
    expect(await call('ds:settings:getCacheMinAge')).toBe(3_600_000)

    await call('ds:settings:setCacheMinAge', 0)
    expect(await call('ds:settings:getCacheMinAge')).toBe(0)
  })

  it('refuses a negative hold', async () => {
    await expect(call('ds:settings:setCacheMinAge', -1)).rejects.toThrow(/0 or more/)
  })
})

describe('the on-request eviction pass', () => {
  it('joins a pass already running instead of starting a second', async () => {
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const calcTotalSize = app.service.fs.calcTotalSize
    const spy = jest.spyOn(app.service.fs, 'calcTotalSize').mockImplementation(async () => {
      await held
      return calcTotalSize()
    })

    const scheduled = app.internal.evictCache(new AbortController().signal)
    const fromSocket = call('ds:cache:evict')
    const again = call('ds:cache:evict')
    release()
    const results = await Promise.all([scheduled, fromSocket, again])

    expect(spy).toHaveBeenCalledTimes(1)
    expect(results[1]).toEqual(results[0])
    expect(results[2]).toEqual(results[0])
  })

  it('runs a clear requested during a pass once that pass has finished', async () => {
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const calcTotalSize = app.service.fs.calcTotalSize
    const spy = jest.spyOn(app.service.fs, 'calcTotalSize').mockImplementationOnce(async () => {
      await held
      return calcTotalSize()
    })

    const scheduled = app.internal.evictCache(new AbortController().signal)
    const cleared = call('ds:cache:clear')
    release()
    await Promise.all([scheduled, cleared])

    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('starts a new pass once the previous one has finished', async () => {
    const spy = jest.spyOn(app.service.fs, 'calcTotalSize')

    await call('ds:cache:evict')
    await call('ds:cache:evict')

    expect(spy).toHaveBeenCalledTimes(2)
  })
})
