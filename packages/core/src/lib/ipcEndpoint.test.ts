import {
  authenticateServer,
  clientEndpoint,
  endpointMarker,
  newPipeEndpoint,
  pipeFile,
  pipeFileText,
  pipeProof,
  type PipeSocket,
} from './ipcEndpoint'

const files = (entries: Record<string, string>) => (path: string) => entries[path] ?? null

describe('clientEndpoint', () => {
  test('off Windows a client connects to the socket path itself, with no secret', () => {
    const read = files({ '/u/.sia/daemon.sock.pipe': '\\\\.\\pipe\\sia-x\nsecret\n' })
    expect(clientEndpoint('/u/.sia/daemon.sock', read, 'darwin')).toEqual({
      address: '/u/.sia/daemon.sock',
      secret: null,
    })
  })

  test('on Windows a client connects to the pipe the daemon wrote, and holds it to its secret', () => {
    const sock = 'C:\\Users\\a\\.sia\\daemon.sock'
    const endpoint = newPipeEndpoint()
    const read = files({ [pipeFile(sock)]: pipeFileText(endpoint).replace(/\n/g, '\r\n') })
    expect(clientEndpoint(sock, read, 'win32')).toEqual({
      address: endpoint.name,
      secret: endpoint.secret,
    })
  })

  test('on Windows with no pipe file a client falls back to the socket path an older daemon served', () => {
    const sock = 'C:\\Users\\a\\.sia\\daemon.sock'
    expect(clientEndpoint(sock, files({}), 'win32')).toEqual({ address: sock, secret: null })
  })
})

describe('newPipeEndpoint', () => {
  test('names a pipe under \\\\.\\pipe\\ and a secret that differ at every start', () => {
    const a = newPipeEndpoint()
    expect(a.name).toMatch(/^\\\\\.\\pipe\\sia-[0-9a-f]{32}$/)
    expect(a.secret).toMatch(/^[0-9a-f]{64}$/)
    const b = newPipeEndpoint()
    expect([b.name, b.secret]).not.toContain(a.name)
    expect(b.secret).not.toBe(a.secret)
  })
})

describe('endpointMarker', () => {
  test('is the socket file off Windows and the pipe file on it', () => {
    expect(endpointMarker('/u/.sia/daemon.sock', 'linux')).toBe('/u/.sia/daemon.sock')
    expect(endpointMarker('C:\\s\\daemon.sock', 'win32')).toBe('C:\\s\\daemon.sock.pipe')
  })
})

/** A socket whose server answers the hello with what `answer` returns for its nonce. */
function fakeServer(answer: (nonce: string) => Promise<string>): PipeSocket {
  let listener: ((chunk: { toString(): string }) => void) | null = null
  return {
    on: (_event, fn) => {
      listener = fn
    },
    off: () => {
      listener = null
    },
    write: (data) => {
      const { id, params } = JSON.parse(data)
      void answer(params.nonce).then((proof) =>
        listener?.(`${JSON.stringify({ id, ok: true, result: { proof } })}\n`),
      )
    },
  }
}

describe('authenticateServer', () => {
  test('accepts a server that answers with the HMAC of the nonce under the secret', async () => {
    const socket = fakeServer((nonce) => pipeProof('the secret', nonce))
    await expect(authenticateServer(socket, 'the secret')).resolves.toBeUndefined()
  })

  test('refuses a server that does not hold the secret', async () => {
    const socket = fakeServer((nonce) => pipeProof('a guess', nonce))
    await expect(authenticateServer(socket, 'the secret')).rejects.toThrow(/not the daemon/)
  })

  test('refuses a server that never answers', async () => {
    const silent: PipeSocket = { on: () => {}, off: () => {}, write: () => {} }
    await expect(authenticateServer(silent, 'the secret', 50)).rejects.toThrow(/did not answer/)
  })

  test('refuses a server that streams more than a reply without a line end', async () => {
    let listener: ((chunk: { toString(): string }) => void) | null = null
    const flooding: PipeSocket = {
      on: (_event, fn) => {
        listener = fn
      },
      off: () => {
        listener = null
      },
      write: () => {
        for (let i = 0; i < 3; i++) listener?.('x'.repeat(2000))
      },
    }
    await expect(authenticateServer(flooding, 'the secret', 60_000)).rejects.toThrow(
      /not the daemon/,
    )
  })
})
