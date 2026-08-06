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
export function buildHandlerMap(app: CliApp, onShutdown: () => void): IpcHandlerMap {
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

/** Serves the full handler map on the CLI socket. */
export function startIpcDispatcher(
  app: CliApp,
  sockPath: string,
  onShutdown: () => void,
  handlers: IpcHandlerMap = buildHandlerMap(app, onShutdown),
): ReturnType<typeof startIpcServer> {
  return startIpcServer(sockPath, async (method, params, connection) => {
    if (method === 'subscribe') return pushChanges(app, connection)
    const handler = handlers.get(method)
    if (!handler) throw new Error(`Unknown method: ${method}`)
    return handler(params, connection)
  })
}
