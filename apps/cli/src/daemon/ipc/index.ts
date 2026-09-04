import { registerAppServiceIpc } from '@siastorage/core/app'
import { startIpcServer, type IpcConnection } from '@siastorage/node-adapters'
import type { ChangeEvent } from '@siastorage/core/types'
import type { CliApp } from '../../app'
import { registerDownloadHandlers } from './download'
import { registerStatusHandlers } from './status'
import { registerUploadHandlers } from './upload'

export type IpcHandler = (
  params: Record<string, unknown>,
  connection: IpcConnection,
) => Promise<unknown>
export type IpcHandlerMap = Map<string, IpcHandler>

/**
 * Builds the handler map the daemon serves: `ping`, `status`, `upload`,
 * `uploadState` and `shutdown` are registered by hand, and every AppService
 * namespace is reflected onto `ds:<namespace>:<method>` channels.
 */
export function buildHandlerMap(
  app: CliApp,
  onShutdown: () => void,
  broadcast?: (message: unknown) => void,
): IpcHandlerMap {
  const handlers: IpcHandlerMap = new Map()

  registerStatusHandlers(handlers, app, onShutdown)
  registerUploadHandlers(handlers, app)
  registerDownloadHandlers(handlers, app)

  registerAppServiceIpc(
    {
      handle: (channel, handler) => {
        handlers.set(channel, async (params) => {
          const args = (params as { args?: unknown[] })?.args ?? []
          return handler(null, ...args)
        })
      },
    },
    app.service,
    // Each mutation, named and uncoalesced, so a client holding its own caches
    // makes the same change. One without caches ignores these.
    broadcast ? (_channel, data) => broadcast(data) : undefined,
  )

  return handlers
}

/**
 * Turns the connection into a one-way stream of change signals. Never resolves:
 * a reply would end the request the subscriber is holding open.
 */
export function pushChanges(app: CliApp, connection: IpcConnection): Promise<never> {
  const stop = app.internal.events.on((scope) => {
    const frame: ChangeEvent = { event: 'change', scope }
    connection.push(frame)
  })
  connection.onClose(stop)
  return new Promise<never>(() => {})
}

/**
 * Everyone currently holding this socket's push stream open.
 *
 * Cache mutations go to all of them, and they arrive uncoalesced. A client
 * replaying them into its own caches needs the key each one names, and a
 * coalesced burst has no single key to name.
 */
export type Subscribers = {
  add(connection: IpcConnection): void
  broadcast(message: unknown): void
}

export function createSubscribers(): Subscribers {
  const connections = new Set<IpcConnection>()
  return {
    add(connection) {
      connections.add(connection)
      connection.onClose(() => connections.delete(connection))
    },
    broadcast(message) {
      for (const connection of connections) connection.push(message)
    },
  }
}

/**
 * A handler map and the subscribers its cache broadcasts reach.
 *
 * One value rather than two arguments: the map is built around a specific
 * subscriber set, so a caller that supplied one and defaulted the other would
 * broadcast into an empty set while real subscribers collected in another, and
 * the cache relay would go quiet with nothing to show for it.
 */
export type IpcSurface = { handlers: IpcHandlerMap; subscribers: Subscribers }

export function buildIpcSurface(app: CliApp, onShutdown: () => void): IpcSurface {
  const subscribers = createSubscribers()
  return { handlers: buildHandlerMap(app, onShutdown, subscribers.broadcast), subscribers }
}

/** Serves the full handler map on the CLI socket. */
export function startIpcDispatcher(
  app: CliApp,
  sockPath: string,
  surface: IpcSurface,
): ReturnType<typeof startIpcServer> {
  const { handlers: map, subscribers } = surface
  return startIpcServer(sockPath, async (method, params, connection) => {
    if (method === 'subscribe') {
      subscribers.add(connection)
      return pushChanges(app, connection)
    }
    const handler = map.get(method)
    if (!handler) throw new Error(`Unknown method: ${method}`)
    return handler(params, connection)
  })
}
