/**
 * Forwards calls from tests to apps that cannot listen for them. A phone in a
 * simulator has no socket a test can connect to, so in test mode it connects
 * out to the mock network over a WebSocket, and a test reaches it with
 * `POST /control/devices/<name>/call`. The app answers each call and the
 * answer goes back as the HTTP response.
 *
 * A killed app's socket closes, but a suspended one's stays open with nobody
 * reading it. So the app reports when it moves to the background, before iOS
 * freezes it, and a call to a device with no socket or one
 * in the background fails at once rather than waiting out its timeout.
 */
import type { ServerWebSocket } from 'bun'
import { type ConnectedDevice, RELAY_PATH } from '../protocol'

type Pending = {
  socket: ServerWebSocket<SocketData>
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}
type SocketData = { device: string }

export type Relay = ReturnType<typeof createRelay>

export function createRelay() {
  const sockets = new Map<string, ServerWebSocket<SocketData>>()
  const lifecycle = new Map<string, 'foreground' | 'background'>()
  const pending = new Map<string, Pending>()
  /** Sockets each device has opened, so a caller can tell a relaunch's socket from the last one's. */
  const opened = new Map<string, number>()
  let seq = 0

  return {
    /** Matches `/relay/<device>`, the path an app connects to. */
    deviceForUpgrade(url: URL): string | null {
      if (!url.pathname.startsWith(`${RELAY_PATH}/`)) return null
      return decodeURIComponent(url.pathname.slice(RELAY_PATH.length + 1)) || null
    },

    websocket: {
      open(ws: ServerWebSocket<SocketData>) {
        sockets.get(ws.data.device)?.close()
        sockets.set(ws.data.device, ws)
        opened.set(ws.data.device, (opened.get(ws.data.device) ?? 0) + 1)
        // The app reports its lifecycle as soon as it connects. Until then it
        // is taken as in the foreground, since it is running code.
        lifecycle.set(ws.data.device, 'foreground')
      },
      message(ws: ServerWebSocket<SocketData>, raw: string | Buffer) {
        const msg = JSON.parse(String(raw)) as {
          id: string
          ok: boolean
          result?: unknown
          error?: string
          lifecycle?: 'foreground' | 'background'
        }
        if (msg.lifecycle) {
          lifecycle.set(ws.data.device, msg.lifecycle)
          return
        }
        const call = pending.get(msg.id)
        if (!call) return
        pending.delete(msg.id)
        if (msg.ok) call.resolve(msg.result)
        else call.reject(new Error(msg.error ?? 'call failed'))
      },
      close(ws: ServerWebSocket<SocketData>) {
        if (sockets.get(ws.data.device) === ws) sockets.delete(ws.data.device)
        // Calls sent over a closed socket, including one a reconnect replaced,
        // get no answer.
        for (const [id, call] of pending) {
          if (call.socket !== ws) continue
          pending.delete(id)
          call.reject(new Error(`${ws.data.device} disconnected before answering`))
        }
      },
    },

    connected(): Record<string, ConnectedDevice> {
      return Object.fromEntries(
        [...sockets.keys()]
          .sort()
          .map((device) => [
            device,
            { sockets: opened.get(device) ?? 0, lifecycle: lifecycle.get(device) ?? 'foreground' },
          ]),
      )
    },

    call(device: string, method: string, args: unknown[], timeoutMs = 60_000): Promise<unknown> {
      const ws = sockets.get(device)
      if (!ws) return Promise.reject(new Error(`${device} is not connected`))
      if (lifecycle.get(device) === 'background') {
        return Promise.reject(new Error(`${device} is in the background, where iOS suspends it`))
      }
      const id = `call-${++seq}`
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(new Error(`${device} did not answer ${method} within ${timeoutMs}ms`))
        }, timeoutMs)
        pending.set(id, {
          socket: ws,
          resolve: (v) => {
            clearTimeout(timer)
            resolve(v)
          },
          reject: (e) => {
            clearTimeout(timer)
            reject(e)
          },
        })
        ws.send(JSON.stringify({ id, method, args }))
      })
    },
  }
}
