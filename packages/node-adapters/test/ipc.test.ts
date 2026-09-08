import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { addAppender, removeAppender } from '@siastorage/logger'
import type { LogEntry } from '@siastorage/logger'
import { connectToIpc, sendIpcCommand, startIpcServer } from '../src/ipc'
import type { IpcServer } from '../src/ipc'

let tempDir: string
let sockPath: string
let server: IpcServer | null

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sia-ipc-test-'))
  sockPath = path.join(tempDir, 'test.sock')
  server = null
})

afterEach(() => {
  server?.close()
  fs.rmSync(tempDir, { recursive: true, force: true })
})

function waitForServer(): Promise<void> {
  return new Promise((r) => setTimeout(r, 50))
}

describe('request logging', () => {
  it('logs a request on arrival and its completion with a duration', async () => {
    const entries: LogEntry[] = []
    const appender = { write: (e: LogEntry) => entries.push(e) }
    addAppender(appender)
    try {
      server = startIpcServer(sockPath, async () => 'ok')
      await waitForServer()
      await sendIpcCommand(sockPath, 'ping')
      const events = entries.filter((e) => e.scope === 'ipc').map((e) => e.message)
      expect(events).toEqual(expect.arrayContaining(['request', 'request_done']))
      const done = entries.find((e) => e.message === 'request_done')
      expect(typeof done?.data?.ms).toBe('number')
    } finally {
      removeAppender(appender)
    }
  })

  it('redacts credentials quoted in a failed request error', async () => {
    const entries: LogEntry[] = []
    const appender = { write: (e: LogEntry) => entries.push(e) }
    addAppender(appender)
    try {
      server = startIpcServer(sockPath, async () => {
        throw new Error('fetch https://user:pa@ss@indexer.test failed')
      })
      await waitForServer()
      await expect(sendIpcCommand(sockPath, 'boom')).rejects.toThrow()
      const failed = entries.find((e) => e.message === 'request_failed')
      expect(failed?.data?.error).toBe('fetch https://<redacted>@indexer.test failed')
      expect(typeof failed?.data?.ms).toBe('number')
    } finally {
      removeAppender(appender)
    }
  })

  it('a result JSON cannot serialize logs one failure, never done and failed both', async () => {
    const entries: LogEntry[] = []
    const appender = { write: (e: LogEntry) => entries.push(e) }
    addAppender(appender)
    try {
      server = startIpcServer(sockPath, async () => ({ big: 1n }))
      await waitForServer()
      await expect(sendIpcCommand(sockPath, 'big')).rejects.toThrow()
      const events = entries.filter((e) => e.scope === 'ipc').map((e) => e.message)
      expect(events.filter((event) => event === 'request_failed')).toHaveLength(1)
      expect(events).not.toContain('request_done')
    } finally {
      removeAppender(appender)
    }
  })

  it('an unprintable character in a method cannot break the log line', async () => {
    const entries: LogEntry[] = []
    const appender = { write: (e: LogEntry) => entries.push(e) }
    addAppender(appender)
    try {
      server = startIpcServer(sockPath, async () => 'ok')
      await waitForServer()
      await sendIpcCommand(sockPath, 'ping\nfake=line')
      const request = entries.find((e) => e.message === 'request')
      expect(request?.data?.method).toBe('ping?fake=line')
    } finally {
      removeAppender(appender)
    }
  })

  it('creates the socket directory when it does not exist yet', async () => {
    const nested = path.join(tempDir, 'container', 'not', 'yet', 'made', 'test.sock')
    server = startIpcServer(nested, async () => 'ok')
    await waitForServer()
    expect(await sendIpcCommand(nested, 'ping')).toBe('ok')
  })

  it('a newline in an error message cannot forge a log line', async () => {
    const entries: LogEntry[] = []
    const appender = { write: (e: LogEntry) => entries.push(e) }
    addAppender(appender)
    try {
      server = startIpcServer(sockPath, async () => {
        throw new Error('first line\nforged=line')
      })
      await waitForServer()
      await expect(sendIpcCommand(sockPath, 'boom')).rejects.toThrow()
      const failed = entries.find((e) => e.message === 'request_failed')
      expect(failed?.data?.error).toBe('first line?forged=line')
    } finally {
      removeAppender(appender)
    }
  })

  it('a malformed frame is logged as a failed request', async () => {
    const entries: LogEntry[] = []
    const appender = { write: (e: LogEntry) => entries.push(e) }
    addAppender(appender)
    try {
      server = startIpcServer(sockPath, async () => 'ok')
      await waitForServer()
      const socket = await connectToIpc(sockPath)
      socket.write('not json\n')
      await new Promise((resolve) => socket.once('data', resolve))
      socket.end()
      const failed = entries.find((e) => e.message === 'request_failed')
      expect(failed?.data?.method).toBe('(malformed)')
    } finally {
      removeAppender(appender)
    }
  })
})

describe('IPC server and client', () => {
  it('server starts and client can send command', async () => {
    server = startIpcServer(sockPath, async (method) => {
      return { echo: method }
    })
    await waitForServer()
    const result = await sendIpcCommand(sockPath, 'test')
    expect(result).toEqual({ echo: 'test' })
  })

  it('handler receives correct method and params', async () => {
    let receivedMethod = ''
    let receivedParams: Record<string, unknown> = {}

    server = startIpcServer(sockPath, async (method, params) => {
      receivedMethod = method
      receivedParams = params
      return 'ok'
    })
    await waitForServer()

    await sendIpcCommand(sockPath, 'doSomething', { key: 'value', num: 42 })
    expect(receivedMethod).toBe('doSomething')
    expect(receivedParams).toEqual({ key: 'value', num: 42 })
  })

  it('returns handler result as ok: true', async () => {
    server = startIpcServer(sockPath, async () => {
      return { data: [1, 2, 3] }
    })
    await waitForServer()

    const result = await sendIpcCommand(sockPath, 'test')
    expect(result).toEqual({ data: [1, 2, 3] })
  })

  it('returns handler error as rejection', async () => {
    server = startIpcServer(sockPath, async () => {
      throw new Error('Something went wrong')
    })
    await waitForServer()

    await expect(sendIpcCommand(sockPath, 'fail')).rejects.toThrow('Something went wrong')
  })

  it('handles multiple sequential commands', async () => {
    let counter = 0
    server = startIpcServer(sockPath, async () => {
      counter++
      return { count: counter }
    })
    await waitForServer()

    const r1 = await sendIpcCommand(sockPath, 'inc')
    const r2 = await sendIpcCommand(sockPath, 'inc')
    const r3 = await sendIpcCommand(sockPath, 'inc')
    expect(r1).toEqual({ count: 1 })
    expect(r2).toEqual({ count: 2 })
    expect(r3).toEqual({ count: 3 })
  })

  it('handles concurrent commands', async () => {
    server = startIpcServer(sockPath, async (method) => {
      await new Promise((r) => setTimeout(r, 10))
      return { method }
    })
    await waitForServer()

    const results = await Promise.all([
      sendIpcCommand(sockPath, 'a'),
      sendIpcCommand(sockPath, 'b'),
      sendIpcCommand(sockPath, 'c'),
    ])
    expect(results).toEqual([{ method: 'a' }, { method: 'b' }, { method: 'c' }])
  })

  it('client times out if server does not respond', async () => {
    const handlerRef: { resolve: (() => void) | null } = { resolve: null }
    server = startIpcServer(sockPath, async () => {
      await new Promise<void>((r) => {
        handlerRef.resolve = r
      })
      return 'too late'
    })
    await waitForServer()

    await expect(sendIpcCommand(sockPath, 'slow', {}, 100)).rejects.toThrow('timed out')
    // Unblock the handler so the server can clean up
    handlerRef.resolve?.()
  })

  it('client gets error if socket does not exist', async () => {
    await expect(sendIpcCommand(sockPath, 'test')).rejects.toThrow()
  })

  it('server removes stale socket file on start', async () => {
    fs.writeFileSync(sockPath, 'stale')
    server = startIpcServer(sockPath, async () => 'ok')
    await waitForServer()

    const result = await sendIpcCommand(sockPath, 'test')
    expect(result).toBe('ok')
  })

  it('close cleans up socket file', async () => {
    server = startIpcServer(sockPath, async () => 'ok')
    await waitForServer()
    server.close()
    server = null
    expect(fs.existsSync(sockPath)).toBe(false)
  })

  it('server handles malformed JSON without crashing', async () => {
    server = startIpcServer(sockPath, async () => 'ok')
    await waitForServer()

    // Send malformed JSON, then a valid command
    const net = require('net')
    const socket = net.createConnection(sockPath)
    await new Promise<void>((r) => socket.on('connect', r))
    socket.write('not json\n')
    await new Promise((r) => setTimeout(r, 50))
    socket.end()

    // Server should still work
    const result = await sendIpcCommand(sockPath, 'test')
    expect(result).toBe('ok')
  })
})
