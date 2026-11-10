import { afterAll, expect, it, mock, spyOn } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/*
 * The change stream against a fake daemon on the real socket path, which
 * records what the stream sends and can drop its connection.
 */

// Set before the imports: the logger fixes its file path when it loads, and
// without this it would write into a real library directory.
const inheritedDataDir = process.env.SIA_DATA_DIR
const dir = mkdtempSync(join(tmpdir(), 'desktop-rpc-'))
process.env.SIA_DATA_DIR = dir

mock.module('electron', () => ({
  app: { getName: () => 'sia.storage.desktop.dev', isPackaged: false },
}))

const { DaemonStream } = await import('./rpc')
const { daemonSocketPath } = await import('./paths')
const endpoint = await import('@siastorage/core/lib/ipcEndpoint')

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
  if (inheritedDataDir === undefined) delete process.env.SIA_DATA_DIR
  else process.env.SIA_DATA_DIR = inheritedDataDir
})

async function until(done: () => boolean, timeoutMs = 4_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!done()) {
    if (Date.now() > deadline) throw new Error('timed out')
    await Bun.sleep(20)
  }
}

it('reports every connect after subscribing, the first and each after a drop', async () => {
  const connections: Socket[] = []
  const frames: string[] = []
  const server = createServer((socket) => {
    connections.push(socket)
    socket.on('data', (chunk) => frames.push(chunk.toString('utf8').trim()))
  })
  await new Promise<void>((resolve) => server.listen(daemonSocketPath(), resolve))
  let ups = 0
  const stream = new DaemonStream(
    () => {},
    undefined,
    undefined,
    () => (ups += 1),
  )
  try {
    stream.start()
    await until(() => ups === 1)

    connections[0].destroy()
    await until(() => ups === 2)

    await until(() => frames.length === 2)
    expect(frames.map((frame) => JSON.parse(frame).method)).toEqual(['subscribe', 'subscribe'])
  } finally {
    stream.stop()
    server.close()
  }
})

it('sends nothing on a connection stopped while the daemon was proving itself', async () => {
  const connections: Socket[] = []
  const server = createServer((socket) => connections.push(socket))
  await new Promise<void>((resolve) => server.listen(daemonSocketPath(), resolve))
  // Connects as on Windows, where the daemon proves itself before anything
  // is sent, with the proof arriving when the test says.
  let prove = () => {}
  const proved = new Promise<void>((resolve) => (prove = resolve))
  const asWindows = spyOn(endpoint, 'clientEndpoint').mockImplementation((address) => ({
    address,
    secret: 'secret',
  }))
  const proving = spyOn(endpoint, 'authenticateServer').mockImplementation(() => proved)
  let ups = 0
  const stream = new DaemonStream(
    () => {},
    undefined,
    undefined,
    () => (ups += 1),
  )
  try {
    stream.start()
    await until(() => connections.length === 1)

    stream.stop()
    prove()
    await Bun.sleep(50)

    expect(ups).toBe(0)
  } finally {
    asWindows.mockRestore()
    proving.mockRestore()
    stream.stop()
    server.close()
  }
})
