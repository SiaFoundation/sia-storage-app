import { logger } from '@siastorage/logger'
import * as fs from 'fs'
import * as net from 'net'

export type IpcHandler = (method: string, params: Record<string, unknown>) => Promise<unknown>

export type IpcServer = {
  close: () => void
}

export function startIpcServer(sockPath: string, handler: IpcHandler): IpcServer {
  // Remove stale socket file
  try {
    fs.unlinkSync(sockPath)
  } catch {
    // may not exist
  }

  const server = net.createServer((socket) => {
    let buffer = ''

    socket.on('data', (chunk) => {
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.trim()) continue
        handleMessage(line, socket, handler)
      }
    })

    socket.on('error', () => {
      // Client disconnected
    })
  })

  server.listen(sockPath, () => {
    logger.debug('ipc', 'server_listening', { path: sockPath })
  })

  server.on('error', (err) => {
    logger.error('ipc', 'server_error', { error: err })
  })

  return {
    close() {
      server.close()
      try {
        fs.unlinkSync(sockPath)
      } catch {
        // may not exist
      }
    },
  }
}

async function handleMessage(line: string, socket: net.Socket, handler: IpcHandler): Promise<void> {
  try {
    const { id, method, params } = JSON.parse(line)
    try {
      const result = await handler(method, params ?? {})
      socket.write(`${JSON.stringify({ id, ok: true, result })}\n`)
    } catch (e) {
      socket.write(
        `${JSON.stringify({
          id,
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        })}\n`,
      )
    }
  } catch {
    socket.write(`${JSON.stringify({ ok: false, error: 'Invalid JSON' })}\n`)
  }
}

export function connectToIpc(sockPath: string): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(sockPath, () => {
      resolve(socket)
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
  const socket = await connectToIpc(sockPath)
  const id = `${Date.now()}-${Math.random()}`

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error(`IPC command '${method}' timed out after ${timeout}ms`))
    }, timeout)

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
