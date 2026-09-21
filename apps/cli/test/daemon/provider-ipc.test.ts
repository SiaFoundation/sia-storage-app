import * as fs from 'node:fs'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import type { IpcHandlerMap } from '../../src/daemon/ipc/index'
import { createMaterializing, type Materializing } from '../../src/daemon/materializing'
import {
  assertSocketPathFits,
  isProviderChannel,
  startProviderListener,
} from '../../src/daemon/ipc/provider'

describe('isProviderChannel', () => {
  it('allows the provider namespace', () => {
    expect(isProviderChannel('ds:provider:list')).toBe(true)
    expect(isProviderChannel('ds:provider:fetch')).toBe(true)
  })

  it('allows the two calls that are not plain request and response', () => {
    expect(isProviderChannel('hello')).toBe(true)
    expect(isProviderChannel('subscribe')).toBe(true)
  })

  it('refuses every other namespace', () => {
    expect(isProviderChannel('ping')).toBe(false)
    expect(isProviderChannel('ds:secrets:getItem')).toBe(false)
    expect(isProviderChannel('ds:auth:clearAppKeys')).toBe(false)
    expect(isProviderChannel('ds:files:deleteAll')).toBe(false)
    expect(isProviderChannel('shutdown')).toBe(false)
    expect(isProviderChannel('upload')).toBe(false)
  })

  it('refuses a channel that merely starts like the provider prefix', () => {
    expect(isProviderChannel('ds:providerX:list')).toBe(false)
  })
})

describe('assertSocketPathFits', () => {
  it('accepts a path within the limit', () => {
    expect(() =>
      assertSocketPathFits('/Users/x/Library/Containers/a.b.c/Data/provider.sock'),
    ).not.toThrow()
  })

  it('refuses a path the kernel would truncate', () => {
    const long = `/${'a'.repeat(120)}/provider.sock`

    expect(() => assertSocketPathFits(long)).toThrow(/over the 103-byte limit/)
  })

  it('counts bytes rather than characters', () => {
    // Each of these is one character but three bytes in UTF-8, so a path that
    // looks short by length is over the limit on the wire.
    const path = `/${'é'.repeat(45)}/provider.sock`

    expect(path.length).toBeLessThan(103)
    expect(() => assertSocketPathFits(path)).toThrow(/over the 103-byte limit/)
  })
})

/*
 * Which connection ends a warm pass. Every call but the change stream opens a
 * socket and closes it on return, so watching request connections for the
 * disconnect would end the pass on the very call that starts it.
 */
describe('a warm pass over the provider socket', () => {
  const sockPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sia-provider-ipc-')), 'p.sock')
  let server: ReturnType<typeof startProviderListener>
  let tracker: Materializing

  async function call(method: string, args: unknown[] = []): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const socket = net.createConnection(sockPath, () => {
        socket.write(`${JSON.stringify({ id: 'c1', method, params: { args } })}\n`)
      })
      socket.on('data', () => socket.end())
      socket.on('close', () => resolve())
      socket.on('error', reject)
    })
  }

  beforeAll(() => {
    tracker = createMaterializing()
    const reflected: IpcHandlerMap = new Map()
    reflected.set('ds:provider:list', async () => ({ items: [] }))
    server = startProviderListener(
      {} as never,
      reflected,
      {
        socketPath: sockPath,
        version: '0.0.1',
        libraryPath: '/tmp/library',
      },
      tracker,
    )
  })

  afterAll(() => server.close())

  it('survives the request connection that started it closing', async () => {
    await call('warm', ['start'])
    await call('ds:provider:list', ['dir:a'])

    expect(tracker.state()).toEqual({ active: true, done: 1 })
  })
})
