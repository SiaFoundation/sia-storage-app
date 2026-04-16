import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { sendIpcCommand, startIpcServer } from '../src/ipc'
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
