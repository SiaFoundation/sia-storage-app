/**
 * Starts the mock network in this process. Tests that need one network for a
 * few in-process apps call this directly. The `sim` orchestrator runs main.ts
 * as its own process instead, so the network outlives every device.
 */
import { createNetworkHandler } from './handler'
import { createRelay } from './relay'
import { NetworkStore } from './store'

export type MockNetwork = {
  url: string
  port: number
  store: NetworkStore
  stop(): Promise<void>
}

/**
 * `publishEveryMs` is how often pending events publish, 1000 as in indexd. A
 * test passes 0 to publish only when it asks, so the timer cannot race it.
 */
export function startMockNetwork(opts: {
  dir: string
  port?: number
  publishEveryMs?: number
}): MockNetwork {
  const store = new NetworkStore(opts.dir)
  const relay = createRelay()
  const handler = createNetworkHandler(store, relay)
  const server = Bun.serve<{ device: string }>({
    port: opts.port ?? 0,
    // Loopback only: the control routes can rewrite the indexer and drive any
    // connected app, and have no authentication. An Android emulator reaches
    // it at 10.0.2.2, which the emulator maps to the host's loopback.
    hostname: '127.0.0.1',
    // Uploads carry whole files.
    maxRequestBodySize: 4 * 1024 ** 3,
    // A commit sleeps out the simulated upload time, which can pass the default.
    idleTimeout: 0,
    fetch(req, srv) {
      const device = relay.deviceForUpgrade(new URL(req.url))
      if (device) {
        return srv.upgrade(req, { data: { device } })
          ? undefined
          : new Response('expected a WebSocket upgrade', { status: 400 })
      }
      return handler.fetch(req)
    },
    websocket: relay.websocket,
  })
  const every = opts.publishEveryMs ?? 1000
  const publisher = every > 0 ? setInterval(() => store.publish(), every) : undefined
  const port = server.port as number
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    store,
    async stop() {
      clearInterval(publisher)
      await server.stop(true)
      store.close()
    },
  }
}
