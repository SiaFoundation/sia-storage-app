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
  /**
   * Listeners on addresses a VM reaches the host at, by hostname. They serve
   * the app routes only. The control routes and the relay stay on loopback,
   * since they rewrite the indexer and drive any connected app with no
   * authentication, and nothing inside a VM calls them.
   */
  const vmListeners = new Map<string, ReturnType<typeof Bun.serve>>()

  const listenForVm = (hostname: string): string => {
    // An unspecified address would serve the app routes to the whole network.
    if (['0.0.0.0', '::', ''].includes(hostname)) {
      throw new Error(`Listen on one address a VM reaches, not ${hostname || 'every address'}`)
    }
    const host = hostname.includes(':') ? `[${hostname}]` : hostname
    const existing = vmListeners.get(hostname)
    if (existing) return `http://${host}:${existing.port}`
    const listener = Bun.serve({
      port: server.port,
      hostname,
      maxRequestBodySize: 4 * 1024 ** 3,
      idleTimeout: 0,
      fetch(req) {
        if (!new URL(req.url).pathname.startsWith('/sdk/')) {
          return Response.json({ error: 'Only /sdk is served on this address' }, { status: 403 })
        }
        return handler.fetch(req)
      },
    })
    vmListeners.set(hostname, listener)
    return `http://${host}:${listener.port}`
  }

  const server = Bun.serve<{ device: string }>({
    port: opts.port ?? 0,
    // Loopback only: the control routes can rewrite the indexer and drive any
    // connected app, and have no authentication. An Android emulator reaches
    // it at 10.0.2.2, which the emulator maps to the host's loopback. A VM
    // reaches the host on an address of its own, which `POST /control/listen`
    // adds a listener on.
    hostname: '127.0.0.1',
    // Uploads carry whole files.
    maxRequestBodySize: 4 * 1024 ** 3,
    // A commit sleeps out the simulated upload time, which can pass the default.
    idleTimeout: 0,
    async fetch(req, srv) {
      const url = new URL(req.url)
      const device = relay.deviceForUpgrade(url)
      if (device) {
        return srv.upgrade(req, { data: { device } })
          ? undefined
          : new Response('expected a WebSocket upgrade', { status: 400 })
      }
      if (url.pathname === '/control/listen' && req.method === 'POST') {
        try {
          const { hostname } = (await req.json()) as { hostname: string }
          return Response.json({ url: listenForVm(String(hostname ?? '')) })
        } catch (e) {
          return Response.json(
            { error: e instanceof Error ? e.message : String(e) },
            { status: 500 },
          )
        }
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
      for (const listener of vmListeners.values()) await listener.stop(true)
      await server.stop(true)
      store.close()
    },
  }
}
