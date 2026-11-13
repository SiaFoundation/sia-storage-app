import {
  authenticateServer,
  clientEndpoint,
  HELLO,
  newPipeEndpoint,
  pipeFile,
  pipeFileText,
  pipeProof,
} from '@siastorage/core/lib/ipcEndpoint'
import { logger } from '@siastorage/logger'
import * as fs from 'fs'
import * as net from 'net'
import * as path from 'path'

/**
 * The connection a request arrived on, for the rare handler that outlives its
 * own reply. A handler that never resolves turns the connection into a one-way
 * stream: nothing is written back for that request, and `push` sends unsolicited
 * frames until the peer disconnects.
 */
export type IpcConnection = {
  /** Sends a frame with no request id, which the client reads as an event. */
  push: (payload: unknown) => void
  /** Runs when the peer disconnects, to release whatever the stream holds. */
  onClose: (fn: () => void) => void
}

export type IpcHandler = (
  method: string,
  params: Record<string, unknown>,
  connection: IpcConnection,
) => Promise<unknown>

export type IpcServer = {
  close: () => void
}

export function startIpcServer(sockPath: string, handler: IpcHandler): IpcServer {
  // The provider socket lives in the File Provider extension's container,
  // which does not exist until the system first loads the extension, so on a
  // fresh machine the bind would fail with ENOENT and never be retried.
  // Owner-only: in a directory a permissive umask left group-writable, any
  // local user could replace the socket, and the chmod below only covers the
  // socket file itself.
  fs.mkdirSync(path.dirname(sockPath), { recursive: true, mode: 0o700 })
  // Remove stale socket file
  try {
    fs.unlinkSync(sockPath)
  } catch {
    // may not exist
  }

  // See ipcEndpoint.ts for why Windows serves a randomly named pipe and
  // answers a hello before anything else.
  const pipe = process.platform === 'win32' ? newPipeEndpoint() : null
  const serve: IpcHandler = pipe
    ? async (method, params, connection) =>
        method === HELLO
          ? { proof: await pipeProof(pipe.secret, String(params.nonce)) }
          : handler(method, params, connection)
    : handler

  const server = net.createServer((socket) => {
    let buffer = ''
    const closeHandlers: Array<() => void> = []
    const connection: IpcConnection = {
      push(payload) {
        if (socket.destroyed) return
        socket.write(`${JSON.stringify(payload)}\n`)
      },
      onClose(fn) {
        closeHandlers.push(fn)
      },
    }

    socket.on('data', (chunk) => {
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.trim()) continue
        handleMessage(line, socket, serve, connection)
      }
    })

    socket.on('close', () => {
      for (const fn of closeHandlers) fn()
      closeHandlers.length = 0
    })

    socket.on('error', () => {
      // Client disconnected
    })
  })

  const endpoint = pipe ? pipe.name : sockPath
  server.listen(endpoint, () => {
    if (pipe) {
      // Written once the pipe accepts connections, and through a rename, so
      // a client never reads half a file or a name before it is served.
      fs.writeFileSync(`${pipeFile(sockPath)}.tmp`, pipeFileText(pipe), { mode: 0o600 })
      fs.renameSync(`${pipeFile(sockPath)}.tmp`, pipeFile(sockPath))
    } else {
      // Restrict the socket to the owning user. Without this, a permissive
      // umask could leave it group/world-accessible and any local user could
      // invoke daemon methods (e.g. `upload` reading arbitrary paths).
      try {
        fs.chmodSync(sockPath, 0o600)
      } catch (err) {
        logger.error('ipc', 'chmod_failed', { error: err as Error })
      }
    }
    logger.debug('ipc', 'server_listening', { path: sockPath, endpoint })
  })

  server.on('error', (err) => {
    logger.error('ipc', 'server_error', { error: err })
  })

  return {
    close() {
      server.close()
      try {
        fs.unlinkSync(pipe ? pipeFile(sockPath) : sockPath)
      } catch {
        // may not exist
      }
    },
  }
}

async function handleMessage(
  line: string,
  socket: net.Socket,
  handler: IpcHandler,
  connection: IpcConnection,
): Promise<void> {
  try {
    const { id, method, params } = JSON.parse(line)
    // The client picks `method`, and the plain log format is line-oriented,
    // so an unprintable character in it could forge or break log lines.
    const logMethod = String(method)
      .replace(/[^\x20-\x7e]/g, '?')
      .slice(0, 128)
    // The only record of what a client asked for, and clients are separate
    // processes, so a slow caller is otherwise a slow daemon. Logged on
    // arrival too: a subscribe holds its promise open for the connection's
    // lifetime and would never reach the completion line.
    logger.debug('ipc', 'request', { method: logMethod })
    const started = performance.now()
    try {
      const result = await handler(method, params ?? {}, connection)
      // Serialized before the completion log: a result JSON cannot represent
      // throws here, and logging first would record the same request as both
      // done and failed.
      const frame = `${JSON.stringify({ id, ok: true, result })}\n`
      logger.debug('ipc', 'request_done', {
        method: logMethod,
        ms: Math.round(performance.now() - started),
      })
      socket.write(frame)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      logger.debug('ipc', 'request_failed', {
        method: logMethod,
        ms: Math.round(performance.now() - started),
        // An error can quote a URL, and a user-entered indexer URL can carry
        // credentials in its authority part. Unprintables go the way of the
        // method's: an upstream newline would forge extra log lines.
        error: message
          .replace(/\/\/[^/\s]+@/g, '//<redacted>@')
          .replace(/[^\x20-\x7e]/g, '?')
          .slice(0, 512),
      })
      socket.write(
        `${JSON.stringify({
          id,
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        })}\n`,
      )
    }
  } catch {
    // The only record of an unparseable frame; there is no method to name.
    logger.debug('ipc', 'request_failed', { method: '(malformed)', error: 'invalid JSON' })
    socket.write(`${JSON.stringify({ ok: false, error: 'Invalid JSON' })}\n`)
  }
}

function readIfExists(path: string): string | null {
  try {
    return fs.readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

/** `timeoutMs` bounds the Windows pipe's hello, which a stalled server never answers. */
export function connectToIpc(sockPath: string, timeoutMs?: number): Promise<net.Socket> {
  const { address, secret } = clientEndpoint(sockPath, readIfExists)
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(address, () => {
      if (!secret) return resolve(socket)
      authenticateServer(socket, secret, timeoutMs).then(
        () => resolve(socket),
        (e: Error) => {
          socket.destroy()
          reject(e)
        },
      )
    })
    socket.on('error', reject)
  })
}

export async function sendIpcCommand(
  sockPath: string,
  method: string,
  params: Record<string, unknown> = {},
  timeout = 30_000,
): Promise<unknown> {
  // One deadline covers the Windows pipe's hello and the reply, so a server
  // that never answers the hello fails a 2s ping after 2s, not 7s.
  const deadline = Date.now() + timeout
  const socket = await connectToIpc(sockPath, timeout)
  const id = `${Date.now()}-${Math.random()}`

  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => {
        socket.destroy()
        reject(new Error(`IPC command '${method}' timed out after ${timeout}ms`))
      },
      Math.max(0, deadline - Date.now()),
    )

    let buffer = ''

    socket.on('data', (chunk) => {
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const response = JSON.parse(line)
          if (response.id === id) {
            clearTimeout(timer)
            socket.end()
            if (response.ok) {
              resolve(response.result)
            } else {
              reject(new Error(response.error))
            }
          }
        } catch {
          // Ignore malformed response lines
        }
      }
    })

    socket.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })

    socket.write(`${JSON.stringify({ id, method, params })}\n`)
  })
}
