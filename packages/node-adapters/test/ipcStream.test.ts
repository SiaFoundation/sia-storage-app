import * as fs from 'fs'
import * as net from 'net'
import * as os from 'os'
import * as path from 'path'
import { startIpcServer, type IpcConnection } from '../src/ipc'

/** Reads newline-delimited frames off a socket as they arrive. */
function collectFrames(socket: net.Socket): unknown[] {
  const frames: unknown[] = []
  let buffer = ''
  socket.on('data', (chunk) => {
    buffer += chunk.toString()
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (line.trim()) frames.push(JSON.parse(line))
    }
  })
  return frames
}

function waitFor(check: () => boolean, timeoutMs = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const tick = () => {
      if (check()) return resolve()
      if (Date.now() - started > timeoutMs) return reject(new Error('timed out'))
      setTimeout(tick, 10)
    }
    tick()
  })
}

describe('IPC push streams', () => {
  let dir: string
  let sockPath: string
  let server: ReturnType<typeof startIpcServer> | undefined
  const clients: net.Socket[] = []

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipc-stream-'))
    sockPath = path.join(dir, 'd.sock')
  })

  afterEach(async () => {
    for (const c of clients) c.destroy()
    clients.length = 0
    server?.close()
    server = undefined
    await new Promise((r) => setTimeout(r, 20))
    fs.rmSync(dir, { recursive: true, force: true })
  })

  function connect(): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(sockPath, () => resolve(socket))
      socket.on('error', reject)
      clients.push(socket)
    })
  }

  it('delivers pushed frames to a subscribed connection', async () => {
    let live: IpcConnection | undefined
    server = startIpcServer(sockPath, async (method, _params, connection) => {
      if (method === 'subscribe') {
        live = connection
        return new Promise<never>(() => {})
      }
      return 'pong'
    })
    await waitFor(() => fs.existsSync(sockPath))

    const socket = await connect()
    const frames = collectFrames(socket)
    socket.write(`${JSON.stringify({ id: '1', method: 'subscribe' })}\n`)
    await waitFor(() => live !== undefined)

    live?.push({ event: 'change', scope: 'library' })

    await waitFor(() => frames.length === 1)
    expect(frames[0]).toEqual({ event: 'change', scope: 'library' })
  })

  it('delivers a push to every subscribed connection independently', async () => {
    const live: IpcConnection[] = []
    server = startIpcServer(sockPath, async (method, _params, connection) => {
      if (method === 'subscribe') {
        live.push(connection)
        return new Promise<never>(() => {})
      }
      return 'pong'
    })
    await waitFor(() => fs.existsSync(sockPath))

    const first = await connect()
    const second = await connect()
    const framesA = collectFrames(first)
    const framesB = collectFrames(second)
    first.write(`${JSON.stringify({ id: '1', method: 'subscribe' })}\n`)
    second.write(`${JSON.stringify({ id: '1', method: 'subscribe' })}\n`)
    await waitFor(() => live.length === 2)

    for (const connection of live) connection.push({ event: 'change', scope: 'library' })

    await waitFor(() => framesA.length === 1 && framesB.length === 1)
    expect(framesA[0]).toEqual(framesB[0])
  })

  it('sends no reply for a request whose handler never resolves', async () => {
    server = startIpcServer(sockPath, async (method) => {
      if (method === 'subscribe') return new Promise<never>(() => {})
      return 'pong'
    })
    await waitFor(() => fs.existsSync(sockPath))

    const socket = await connect()
    const frames = collectFrames(socket)
    socket.write(`${JSON.stringify({ id: '1', method: 'subscribe' })}\n`)
    socket.write(`${JSON.stringify({ id: '2', method: 'ping' })}\n`)

    await waitFor(() => frames.length === 1)
    await new Promise((r) => setTimeout(r, 100))
    expect(frames).toEqual([{ id: '2', ok: true, result: 'pong' }])
  })

  it('runs close handlers when the peer disconnects', async () => {
    let released = false
    server = startIpcServer(sockPath, async (_method, _params, connection) => {
      connection.onClose(() => {
        released = true
      })
      return 'ok'
    })
    await waitFor(() => fs.existsSync(sockPath))

    const socket = await connect()
    socket.write(`${JSON.stringify({ id: '1', method: 'anything' })}\n`)
    await new Promise((r) => setTimeout(r, 50))
    socket.destroy()

    await waitFor(() => released)
    expect(released).toBe(true)
  })

  it('drops a push to a connection that already went away', async () => {
    let live: IpcConnection | undefined
    server = startIpcServer(sockPath, async (_method, _params, connection) => {
      live = connection
      return 'ok'
    })
    await waitFor(() => fs.existsSync(sockPath))

    const socket = await connect()
    socket.write(`${JSON.stringify({ id: '1', method: 'anything' })}\n`)
    await waitFor(() => live !== undefined)
    socket.destroy()
    await new Promise((r) => setTimeout(r, 50))

    expect(() => live?.push({ event: 'change', scope: 'library' })).not.toThrow()
  })
})
