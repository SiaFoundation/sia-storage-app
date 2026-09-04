/*
 * Client for the daemon's facade socket.
 *
 * The daemon reflects every AppService namespace onto `ds:<namespace>:<method>`,
 * so this needs no per-method code and gains nothing when the facade grows.
 *
 * A call opens its own short-lived connection. Replies are therefore never
 * interleaved and no request-id bookkeeping is needed, which matters because the
 * window and the tray both issue calls concurrently. The subscription is the one
 * connection held open.
 */

import type { ChangeEvent } from '@siastorage/core/types'
import { connect, type Socket } from 'node:net'
import { daemonSocketPath } from './paths'

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
 * Two kinds of frame arrive on it. A change signal says a scope moved, for a
 * reader that re-reads whatever it wants. A cache message names a key the daemon
 * just changed and carries the new value when it has one, for a reader holding
 * its own copy of the same caches.
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
    private readonly onCache: (message: unknown) => void = () => {},
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
            const parsed = JSON.parse(line)
            if (parsed.event === 'change') this.onEvent(parsed as ChangeEvent)
            else if (parsed.kind === 'cache') this.onCache(parsed)
          } catch {
            // Anything else is a reply to a request this stream never sends, so
            // it is ignored rather than treated as an error.
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
