import { registerAppServiceIpc } from '@siastorage/core/app'
import { startIpcServer } from '@siastorage/node-adapters'
import type { CliApp } from '../../app'
import { registerDownloadHandlers } from './download'
import { registerStatusHandlers } from './status'
import { registerUploadHandlers } from './upload'

export type IpcHandler = (params: Record<string, unknown>) => Promise<unknown>
export type IpcHandlerMap = Map<string, IpcHandler>

/**
 * Wires the daemon's IPC server. Custom handlers (`ping`, `status`, `upload`,
 * `uploadState`, `shutdown`) are registered explicitly; the AppService facade
 * is reflected onto `ds:<namespace>:<method>` channels via
 * `registerAppServiceIpc`. Both flow through the same handler map. Feature
 * branches (e.g. `cli/watch`) extend the handler map by registering their own
 * custom handlers in this same way.
 */
export function startIpcDispatcher(
  app: CliApp,
  sockPath: string,
  onShutdown: () => void,
): ReturnType<typeof startIpcServer> {
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

  return startIpcServer(sockPath, async (method, params) => {
    const handler = handlers.get(method)
    if (!handler) throw new Error(`Unknown method: ${method}`)
    return handler(params)
  })
}
