/*
 * The second IPC listener, the one an OS storage-provider shell connects to.
 *
 * It serves the same reflected AppService handler map as the CLI socket, but
 * behind a channel filter: the shell is a separate, sandboxed process on a
 * stable OS contract, and there is no reason for a bug in it to be able to
 * reach `secrets.getItem` or `auth.clearAppKeys`.
 */
import { logger } from '@siastorage/logger'
import { startIpcServer } from '@siastorage/node-adapters'
import type { CliApp } from '../../app'
import { pushChanges, type IpcHandlerMap } from './index'

/** `sun_path` is 104 bytes on macOS including the terminator. */
const MAX_SOCKET_PATH = 103

const PROVIDER_CHANNEL_PREFIX = 'ds:provider:'

export type ProviderListenerOptions = {
  socketPath: string
  /** Build identifier the shell must match. */
  version: string
}

/**
 * Rejects a socket path the kernel would silently truncate. A truncated path
 * binds somewhere unintended, and the shell then fails to connect with an error
 * that says nothing about the real cause.
 */
export function assertSocketPathFits(socketPath: string): void {
  const bytes = Buffer.byteLength(socketPath, 'utf8')
  if (bytes > MAX_SOCKET_PATH) {
    throw new Error(
      `Provider socket path is ${bytes} bytes, over the ${MAX_SOCKET_PATH}-byte limit: ${socketPath}`,
    )
  }
}

/** Channels the provider socket serves. Everything else is refused. */
export function isProviderChannel(channel: string): boolean {
  return (
    channel.startsWith(PROVIDER_CHANNEL_PREFIX) || channel === 'hello' || channel === 'subscribe'
  )
}

/**
 * Registers the version handshake. The OS caches an extension across app
 * upgrades and can pair a stale one with a new daemon, so a mismatch serves
 * errors rather than guessing, and the version is never negotiated down.
 */
function registerProviderHandlers(reflected: IpcHandlerMap, version: string): void {
  reflected.set('hello', async (params) => {
    const theirs = ((params as { args?: unknown[] }).args?.[0] as string) ?? undefined
    if (theirs !== version) {
      throw new Error(`Version mismatch: shell ${theirs ?? 'unknown'}, daemon ${version}`)
    }
    return { version }
  })
}

export function startProviderListener(
  app: CliApp,
  reflected: IpcHandlerMap,
  opts: ProviderListenerOptions,
): ReturnType<typeof startIpcServer> {
  assertSocketPathFits(opts.socketPath)

  registerProviderHandlers(reflected, opts.version)
  logger.info('ipc', 'provider_listener_ready', { path: opts.socketPath })

  return startIpcServer(opts.socketPath, async (method, params, connection) => {
    if (!isProviderChannel(method)) {
      throw new Error(`Channel not available on the provider socket: ${method}`)
    }
    if (method === 'subscribe') return pushChanges(app, connection)
    const handler = reflected.get(method)
    if (!handler) throw new Error(`Unknown method: ${method}`)
    return handler(params, connection)
  })
}
