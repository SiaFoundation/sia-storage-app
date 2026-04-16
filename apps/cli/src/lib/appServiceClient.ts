import { createRemoteAppService } from '@siastorage/core/app'
import type { AppService } from '@siastorage/core/app'
import { sendIpcCommand } from '@siastorage/node-adapters'

/**
 * Creates an AppService proxy that forwards all calls to the daemon via IPC.
 * Uses the same `createRemoteAppService` infrastructure as Electron/web worker
 * transports — the daemon registers handlers with `registerAppServiceIpc`,
 * and this client invokes them over the Unix socket.
 */
export function createDaemonClient(sockPath: string, timeout = 30_000): AppService {
  return createRemoteAppService((channel: string, ...args: any[]) =>
    sendIpcCommand(sockPath, channel, { args }, timeout),
  )
}
