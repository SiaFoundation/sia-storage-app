import * as fs from 'fs'
import * as net from 'net'
import * as os from 'os'
import * as path from 'path'
import { startIpcServer, type IpcConnection } from '../src/ipc'
import { type HeldMountLink, holdMountLink } from '../src/mountLink'

function waitFor(check: () => boolean, timeoutMs = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const tick = () => {
      if (check()) return resolve()
      if (Date.now() - started > timeoutMs) return reject(new Error('timed out'))
      setTimeout(tick, 10)
    }
    tick()
  })
}

describe("the integration's end of the mount link", () => {
  let dir: string
  let sockPath: string
  let server: ReturnType<typeof startIpcServer>
  let link: HeldMountLink | undefined
  /** The connection that called `mount`, and whether it has closed. */
  let held: IpcConnection | undefined
  let closed = false
  let answers: unknown[][]
  let refuses = false

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mount-link-'))
    sockPath = path.join(dir, 'd.sock')
    held = undefined
    closed = false
    answers = []
    refuses = false
    server = startIpcServer(sockPath, async (method, params, connection) => {
      if (method === 'mount' && refuses) throw new Error('Channel not available')
      if (method === 'mount') {
        held = connection
        connection.onClose(() => {
          closed = true
        })
      } else if (method === 'mountAnswer') {
        answers.push((params as { args: unknown[] }).args)
      }
      return { ok: true }
    })
  })

  afterEach(async () => {
    link?.close()
    link = undefined
    server.close()
    await new Promise((r) => setTimeout(r, 20))
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('resolves once the daemon has the link, and answers each question by its request', async () => {
    const asked: unknown[][] = []
    link = await holdMountLink(sockPath, async (verb, stackIds) => {
      asked.push([verb, stackIds])
      return verb === 'list' ? ['a'] : { a: 'done' }
    })
    expect(held).toBeDefined()

    held?.push({ event: 'mount', request: 'r1', verb: 'dehydrate', stackIds: ['a'] })
    held?.push({ event: 'mount', request: 'r2', verb: 'list', stackIds: [] })
    await waitFor(() => answers.length === 2)

    expect(asked).toEqual([
      ['dehydrate', ['a']],
      ['list', []],
    ])
    expect(answers).toEqual(
      expect.arrayContaining([
        ['r1', { a: 'done' }],
        ['r2', ['a']],
      ]),
    )
  })

  it('answers a question with null when answering it fails', async () => {
    link = await holdMountLink(sockPath, async (verb) => {
      if (verb === 'resend') throw new Error('cannot')
      return {}
    })

    held?.push({ event: 'mount', request: 'r1', verb: 'resend', stackIds: ['a'] })
    held?.push({ event: 'mount', request: 'r2', verb: 'dehydrate', stackIds: ['a'] })
    await waitFor(() => answers.length === 2)

    expect(answers).toEqual(
      expect.arrayContaining([
        ['r1', null],
        ['r2', {}],
      ]),
    )
  })

  it('skips a line from the daemon that is not JSON, and answers the next question', async () => {
    server.close()
    const raw = net.createServer((socket) => {
      let buffer = ''
      socket.on('data', (chunk) => {
        buffer += chunk.toString()
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          const { id, method, params } = JSON.parse(line)
          socket.write(`${JSON.stringify({ id, ok: true, result: { ok: true } })}\n`)
          if (method === 'mountAnswer') answers.push(params.args)
          if (method === 'mount') {
            socket.write('{not json\n')
            socket.write(
              `${JSON.stringify({ event: 'mount', request: 'r1', verb: 'list', stackIds: [] })}\n`,
            )
          }
        }
      })
    })
    await new Promise<void>((resolve) => raw.listen(sockPath, resolve))
    try {
      link = await holdMountLink(sockPath, async () => ['a'])
      await waitFor(() => answers.length === 1)
      expect(answers).toEqual([['r1', ['a']]])
    } finally {
      link?.close()
      link = undefined
      raw.close()
    }
  })

  it('reports the connection ending, and the daemon sees the link go', async () => {
    link = await holdMountLink(sockPath, async () => ({}))
    let ended = false
    void link.closed.then(() => {
      ended = true
    })

    link.close()
    await waitFor(() => ended && closed)
  })

  it('rejects when the daemon refuses the link', async () => {
    refuses = true
    await expect(holdMountLink(sockPath, async () => ({}))).rejects.toThrow(/not available/)
  })

  it('rejects when no daemon is serving the socket', async () => {
    await expect(holdMountLink(path.join(dir, 'missing.sock'), async () => ({}))).rejects.toThrow()
  })
})
