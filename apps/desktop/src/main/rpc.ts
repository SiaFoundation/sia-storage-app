/*
 * Client for the daemon's facade socket.
 *
 * The daemon reflects every AppService namespace onto `ds:<namespace>:<method>`,
 * so this needs no per-method code and gains nothing when the facade grows.
 *
 * A call opens its own short-lived connection, so replies never interleave and
 * no request-id bookkeeping is needed, which matters because the window and the
 * tray issue calls concurrently. The subscription is the one held open.
 */

import type { CacheMethod, IpcMessage } from '@siastorage/core/app'
import type { ChangeEvent } from '@siastorage/core/types'
import { connect, type Socket } from 'node:net'
import { log } from './log'
import { daemonSocketPath } from './paths'

/** A `Record` keyed by the union, so adding a method fails to compile here. */
const CACHE_METHODS: Record<CacheMethod, true> = {
  invalidate: true,
  invalidateAll: true,
  set: true,
}

/** Narrows from `unknown`, so no call site has to cast to reach the check. */
function isChangeEvent(frame: unknown): frame is ChangeEvent {
  return Boolean(frame) && typeof frame === 'object' && (frame as ChangeEvent).event === 'change'
}

/**
 * Checks the shape before it is replayed into another process's caches. The
 * frame crosses a socket, so its fields are claims until something reads them.
 *
 * The arguments are checked per method, because they are spread straight into
 * the call: every cache key part is a string, and only `set` carries a value
 * in front of them.
 */
function isCacheFrame(frame: unknown): frame is IpcMessage {
  if (!frame || typeof frame !== 'object') return false
  const { kind, path, method, args } = frame as Partial<IpcMessage>
  if (kind !== 'cache' || typeof method !== 'string') return false
  if (!Array.isArray(path) || !path.every((part) => typeof part === 'string')) return false
  if (!Array.isArray(args) || !Object.hasOwn(CACHE_METHODS, method)) return false
  const keyParts = method === 'set' ? args.slice(1) : args
  return (
    (method !== 'invalidateAll' || args.length === 0) &&
    (method !== 'set' || args.length >= 1) &&
    keyParts.every((part) => typeof part === 'string')
  )
}

export class RpcError extends Error {}

let nextId = 0

export function call(method: string, args: unknown[] = [], timeoutMs = 15_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = connect(daemonSocketPath())
    let buffer = ''
    let settled = false

    const finish = (err: Error | null, value?: unknown) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      if (err) reject(err)
      else resolve(value)
    }

    const timer = setTimeout(() => finish(new RpcError(`${method} timed out`)), timeoutMs)

    socket.on('connect', () => {
      const id = `d${(nextId += 1)}`
      socket.write(`${JSON.stringify({ id, method, params: { args } })}\n`)
    })
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      const newline = buffer.indexOf('\n')
      if (newline === -1) return
      try {
        const reply = JSON.parse(buffer.slice(0, newline))
        if (reply.ok) finish(null, reply.result)
        else finish(new RpcError(reply.error ?? `${method} failed`))
      } catch (e) {
        finish(new RpcError(`${method}: ${(e as Error).message}`))
      }
    })
    socket.on('error', (e) => finish(new RpcError(`${method}: ${e.message}`)))
    socket.on('close', () => finish(new RpcError(`${method}: connection closed`)))
  })
}

/**
 * Holds one connection open for everything the daemon pushes, reconnecting when
 * it drops. The daemon outlives this process and restarts under it, so a dropped
 * stream is expected rather than exceptional.
 *
 * Two kinds of frame arrive: a change signal saying a scope moved, and a cache
 * message naming a key the daemon changed, with the new value when it has one.
 */
export class DaemonStream {
  private socket: Socket | null = null
  private stopped = false
  private retry: NodeJS.Timeout | null = null

  /**
   * `onDown` fires each time a reconnect attempt fails, so the caller can count
   * them and decide the daemon is gone rather than restarting. Deciding that
   * here would put process supervision inside a transport.
   */
  constructor(
    private readonly onEvent: (event: ChangeEvent) => void,
    private readonly onCache: (message: IpcMessage) => void = () => {},
    private readonly onDown: () => void = () => {},
  ) {}

  start(): void {
    if (this.stopped) return
    // One connection, as the class promises: a second start would otherwise
    // leave the first open and duplicate every event.
    this.socket?.destroy()
    const socket = connect(daemonSocketPath())
    this.socket = socket
    let buffer = ''

    socket.on('connect', () => {
      socket.write(`${JSON.stringify({ id: 'subscribe', method: 'subscribe' })}\n`)
    })
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      let newline = buffer.indexOf('\n')
      while (newline !== -1) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        if (line.trim()) {
          try {
            const parsed: unknown = JSON.parse(line)
            // Any other frame answers a request this stream never sends, so it
            // matches neither branch and is dropped.
            if (isChangeEvent(parsed)) this.onEvent(parsed)
            else if (isCacheFrame(parsed)) this.onCache(parsed)
          } catch {
            // Reported rather than reconnected: the daemon sent something this
            // build cannot read, and retrying the same stream would loop on it.
            log.error(`the daemon sent a frame this build cannot read: ${line.slice(0, 200)}`)
          }
        }
        newline = buffer.indexOf('\n')
      }
    })
    let reported = false
    const reconnect = () => {
      if (this.stopped) return
      socket.destroy()
      // Both handlers fire for one drop, and a caller counting failures must
      // not see it twice.
      if (!reported) {
        reported = true
        this.onDown()
      }
      if (this.retry) clearTimeout(this.retry)
      this.retry = setTimeout(() => this.start(), 1_000)
    }
    socket.on('error', reconnect)
    socket.on('close', reconnect)
  }

  stop(): void {
    this.stopped = true
    if (this.retry) clearTimeout(this.retry)
    this.socket?.destroy()
    this.socket = null
  }
}
