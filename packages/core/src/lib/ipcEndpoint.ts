/**
 * Where a daemon's socket is served and reached, and on Windows how a client
 * knows the server is the daemon.
 *
 * On macOS and Linux it is the socket path itself, a Unix domain socket in
 * the user's data directory. On Windows, Node serves and reaches local IPC
 * only as a named pipe under `\\.\pipe\`, and the desktop app runs on
 * Electron's Node, so the daemon serves a pipe there. Every account on a
 * Windows machine shares one pipe namespace and can list the names in it, so
 * a name alone proves nothing: a daemon killed without shutting down leaves
 * its name in the pipe file, and another account could then serve a pipe by
 * that name and receive the app's calls, recovery phrase included.
 *
 * So the daemon picks a random name and a random secret at each start and
 * writes both to the pipe file beside the socket path, in the user's own data
 * directory. Before a client sends anything it asks the server to prove it
 * holds the secret, by answering a fresh nonce with an HMAC of it, and it
 * drops a server that cannot.
 *
 * With no pipe file a client uses the socket path, which is what a Windows
 * daemon from before this served, as an AF_UNIX socket file that Bun can
 * reach. A CLI updated while such a daemon runs still talks to it.
 */

/** The file a Windows daemon writes its pipe's name and secret to. */
export function pipeFile(sockPath: string): string {
  return `${sockPath}.pipe`
}

export type PipeEndpoint = { name: string; secret: string }

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

const randomHex = (length: number) => hex(crypto.getRandomValues(new Uint8Array(length)))

/** A pipe name and secret no other account can predict. */
export function newPipeEndpoint(): PipeEndpoint {
  return { name: `\\\\.\\pipe\\sia-${randomHex(16)}`, secret: randomHex(32) }
}

/** The pipe file's contents: the name, then the secret, a line each. */
export function pipeFileText(endpoint: PipeEndpoint): string {
  return `${endpoint.name}\n${endpoint.secret}\n`
}

const currentPlatform = () => (typeof process === 'undefined' ? '' : process.platform)

/**
 * The address a client connects to, and the secret its server must prove it
 * holds, which is null off Windows and for a daemon with no pipe file.
 * `readFile` returns a file's text, or null when it does not exist.
 */
export function clientEndpoint(
  sockPath: string,
  readFile: (path: string) => string | null,
  platform: string = currentPlatform(),
): { address: string; secret: string | null } {
  if (platform !== 'win32') return { address: sockPath, secret: null }
  const [name, secret] = (readFile(pipeFile(sockPath)) ?? '').split(/\r?\n/)
  return name && secret ? { address: name, secret } : { address: sockPath, secret: null }
}

/**
 * The file whose presence says a daemon may be serving: the socket file, or
 * on Windows the pipe file. Checking for the pipe itself would connect to it
 * as a client and use up the instance the daemon left for the next caller.
 */
export function endpointMarker(sockPath: string, platform: string = currentPlatform()): string {
  return platform === 'win32' ? pipeFile(sockPath) : sockPath
}

/** The request a client sends first on a Windows pipe, and the method the daemon answers it on. */
export const HELLO = 'hello'

export function newNonce(): string {
  return randomHex(16)
}

/** What a server holding `secret` answers to `nonce`: HMAC-SHA256, in hex. */
export async function pipeProof(secret: string, nonce: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return hex(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(nonce))))
}

/** What `authenticateServer` needs of a connected socket. A Node or Bun socket fits. */
export type PipeSocket = {
  write(data: string): unknown
  on(event: 'data', listener: (chunk: { toString(): string }) => void): unknown
  off(event: 'data', listener: (chunk: { toString(): string }) => void): unknown
}

/**
 * Asks the server on a just-connected Windows pipe to prove it holds the
 * daemon's secret, and resolves once it has. Run before the first request,
 * since the daemon sends nothing until asked, so the first line back is the
 * answer to this.
 */
const MAX_HELLO_REPLY = 4096

export function authenticateServer(
  socket: PipeSocket,
  secret: string,
  timeoutMs = 5_000,
): Promise<void> {
  const nonce = newNonce()
  return new Promise((resolve, reject) => {
    let buffer = ''
    const timer = setTimeout(() => {
      socket.off('data', onData)
      reject(new Error('The daemon pipe did not answer its hello'))
    }, timeoutMs)
    const onData = (chunk: { toString(): string }) => {
      buffer += chunk.toString()
      const newline = buffer.indexOf('\n')
      if (newline === -1) {
        // The daemon's answer is about a hundred bytes. A server that sends
        // more with no line end is dropped before it can fill memory.
        if (buffer.length <= MAX_HELLO_REPLY) return
        socket.off('data', onData)
        clearTimeout(timer)
        reject(new Error('The server on the daemon pipe is not the daemon'))
        return
      }
      socket.off('data', onData)
      clearTimeout(timer)
      let proof: unknown
      try {
        proof = JSON.parse(buffer.slice(0, newline))?.result?.proof
      } catch {}
      void pipeProof(secret, nonce).then((expected) =>
        proof === expected
          ? resolve()
          : reject(new Error('The server on the daemon pipe is not the daemon')),
      )
    }
    socket.on('data', onData)
    socket.write(`${JSON.stringify({ id: HELLO, method: HELLO, params: { nonce } })}\n`)
  })
}
