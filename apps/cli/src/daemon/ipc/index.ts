import { registerAppServiceIpc } from '@siastorage/core/app'
import { startIpcServer, type IpcConnection } from '@siastorage/node-adapters'
import type { ChangeEvent } from '@siastorage/core/types'
import type { CliApp } from '../../app'
import { createMaterializing, type Materializing } from '../materializing'
import { registerDownloadHandlers } from './download'
import { registerStatusHandlers } from './status'
import { registerUploadHandlers } from './upload'

export type IpcHandler = (
  params: Record<string, unknown>,
  connection: IpcConnection,
) => Promise<unknown>
export type IpcHandlerMap = Map<string, IpcHandler>

/**
 * Builds the handler map the daemon serves. `ping`, `status`, `upload`,
 * `uploadState` and `shutdown` are registered explicitly because they are the
 * daemon's own; every AppService namespace is reflected onto
 * `ds:<namespace>:<method>`.
 */
export function buildHandlerMap(
  app: CliApp,
  onShutdown: () => void,
  broadcast?: (message: unknown) => void,
  materializing: Materializing = createMaterializing(),
): IpcHandlerMap {
  const handlers: IpcHandlerMap = new Map()

  registerStatusHandlers(handlers, app, onShutdown, materializing)
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
 * Cache mutations reach all of them uncoalesced: a client replaying them into
 * its own caches needs the key each one names, and a coalesced burst has none.
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
 * One value rather than two arguments, because the map closes over a specific
 * `Subscribers`, and passing a different one would broadcast into an empty set.
 */
export type IpcSurface = {
  handlers: IpcHandlerMap
  subscribers: Subscribers
  /** Shared with the provider socket, which is where the evidence arrives. */
  materializing: Materializing
}

export function buildIpcSurface(app: CliApp, onShutdown: () => void): IpcSurface {
  const subscribers = createSubscribers()
  const materializing = createMaterializing()
  return {
    handlers: buildHandlerMap(app, onShutdown, subscribers.broadcast, materializing),
    subscribers,
    materializing,
  }
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
