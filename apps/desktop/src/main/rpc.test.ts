import { afterAll, expect, it, mock } from 'bun:test'
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

it('reports every connect after subscribing, and whether it follows a drop', async () => {
  const connections: Socket[] = []
  const frames: string[] = []
  const server = createServer((socket) => {
    connections.push(socket)
    socket.on('data', (chunk) => frames.push(chunk.toString('utf8').trim()))
  })
  await new Promise<void>((resolve) => server.listen(daemonSocketPath(), resolve))
  const ups: boolean[] = []
  const stream = new DaemonStream(
    () => {},
    undefined,
    undefined,
    (recovered) => ups.push(recovered),
  )
  try {
    stream.start()
    await until(() => ups.length === 1)
    expect(ups).toEqual([false])

    connections[0].destroy()
    await until(() => ups.length === 2)
    expect(ups).toEqual([false, true])

    await until(() => frames.length === 2)
    expect(frames.map((frame) => JSON.parse(frame).method)).toEqual(['subscribe', 'subscribe'])
  } finally {
    stream.stop()
    server.close()
  }
})
