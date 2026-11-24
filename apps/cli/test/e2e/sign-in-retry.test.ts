jest.setTimeout(60_000)
import * as fs from 'fs'
import * as http from 'http'
import type { AddressInfo } from 'net'
import { readState, sendIpcCommand } from '@siastorage/node-adapters'
import { createE2eContext } from './helpers'

/*
 * The real SDK rather than test mode, whose connect never touches a network.
 * The indexer is a local server answering the two requests the SDK's connect
 * makes: `/auth/check`, where 204 accepts the key, and `/hosts`.
 */

let ctx: ReturnType<typeof createE2eContext>
let indexer: http.Server | null = null

afterEach(async () => {
  await ctx.stopDaemon().catch(() => {})
  ctx.cleanup()
  await new Promise<void>((resolve) => (indexer ? indexer.close(() => resolve()) : resolve()))
  indexer = null
})

/** A port nothing listens on yet, so connecting to it is refused as with no network. */
async function unusedPort(): Promise<number> {
  const probe = http.createServer()
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve))
  const { port } = probe.address() as AddressInfo
  await new Promise<void>((resolve) => probe.close(() => resolve()))
  return port
}

function startIndexer(port: number): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    const route = new URL(req.url ?? '/', 'http://indexer').pathname
    if (route === '/auth/check') {
      res.writeHead(204).end()
    } else if (route === '/hosts') {
      res.writeHead(200, { 'content-type': 'application/json' }).end('[]')
    } else {
      res.writeHead(404).end()
    }
  })
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)))
}

async function connected(): Promise<boolean> {
  const status = (await sendIpcCommand(ctx.paths.sockPath, 'status', {}, 2_000)) as {
    connected: boolean
  }
  return status.connected
}

describe('a daemon started before the network is up', () => {
  it('signs in once the indexer can be reached, without a restart', async () => {
    ctx = createE2eContext({ testMode: false })
    const port = await unusedPort()
    const indexerURL = `http://127.0.0.1:${port}`
    // What a sign-in leaves behind: the indexer and the app key registered with it.
    fs.writeFileSync(ctx.paths.storagePath, JSON.stringify({ hasOnboarded: 'true', indexerURL }))
    fs.writeFileSync(
      ctx.paths.secretsPath,
      JSON.stringify({ appKeys: JSON.stringify({ [indexerURL]: '11'.repeat(32) }) }),
    )

    await ctx.startDaemon()
    expect(await connected()).toBe(false)
    // Long enough for the first attempt to fail and the first retry to be due.
    await new Promise((r) => setTimeout(r, 1_500))
    expect(await connected()).toBe(false)

    indexer = await startIndexer(port)

    const deadline = Date.now() + 30_000
    while (!(await connected()) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 250))
    }
    expect(await connected()).toBe(true)
    expect(readState(ctx.paths.statePath)?.connected).toBe(true)
  })
})
