import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { copyFileSync, existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { freePort } from '../src/process'
import { waitFor } from '../src/wait'
import { psQuote } from '../src/windows/host'
import { autounattend } from '../src/windows/unattend'

describe('autounattend', () => {
  const xml = autounattend({
    adminPassword: 'a<b>&"c',
    testPassword: 'plain1A!',
    computerName: 'SIA-SIM',
  })

  test('stores a password with & in the registry as typed, escaped once for the XML', () => {
    const withAmp = autounattend({
      adminPassword: 'x1A!',
      testPassword: 'p&q1A!',
      computerName: 'S',
    })
    expect(withAmp).toContain('/d &quot;p&amp;q1A!&quot;')
    expect(withAmp).not.toContain('&amp;amp;')
  })

  test('escapes passwords so the answer file stays valid XML', () => {
    expect(xml).toContain('a&lt;b&gt;&amp;&quot;c')
    expect(xml).not.toContain('a<b>&"c')
  })

  test('makes the admin an administrator and the test account a plain user', () => {
    expect(xml).toMatch(/<Name>siaadmin<\/Name><Group>Administrators<\/Group>/)
    expect(xml).toMatch(/<Name>siatest<\/Name><Group>Users<\/Group>/)
  })

  test('signs the admin in once, and the first sign-in hands automatic sign-in to the test account', () => {
    expect(xml).toMatch(/<LogonCount>1<\/LogonCount><Username>siaadmin<\/Username>/)
    expect(xml).toContain('DefaultUserName /t REG_SZ /d siatest')
    expect(xml).toContain('PTAgent.exe')
  })

  test('installs Parallels Tools before it restarts, in one command, since Windows starts first logon commands together', () => {
    const commands = [...xml.matchAll(/<CommandLine>(.*?)<\/CommandLine>/g)].map((m) => m[1]!)
    expect(commands).toHaveLength(1)
    const steps = commands[0]!.split(' &amp; ')
    expect(steps[0]).toStartWith('cmd /c powershell')
    expect(steps[0]).toContain('PTAgent.exe')
    expect(steps.at(-1)).toBe('shutdown /r /t 5')
  })
})

describe('psQuote', () => {
  test('doubles straight and curly single quotes and leaves $ alone', () => {
    expect(psQuote("it's $HOME")).toBe("'it''s $HOME'")
    expect(psQuote('it\u2019s')).toBe("'it\u2019\u2019s'")
  })
})

describe('agent', () => {
  let dir: string
  let port: number
  let agent: ReturnType<typeof Bun.spawn>
  const call = (path: string, body: unknown = {}, token = 'tok') =>
    fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      headers: { 'x-sim-token': token },
      body: JSON.stringify(body),
    })

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'sim-agent-'))
    copyFileSync(join(import.meta.dir, '../src/windows/agent.ts'), join(dir, 'agent.ts'))
    writeFileSync(join(dir, 'token'), 'tok\n')
    port = freePort()
    agent = Bun.spawn([process.execPath, join(dir, 'agent.ts')], {
      cwd: dir,
      env: { ...process.env, SIM_AGENT_PORT: String(port) },
      stdout: 'ignore',
      stderr: 'ignore',
    })
    await waitFor('the agent to listen', () => call('/health').then((r) => r.ok), {
      timeoutMs: 10_000,
    })
  })

  afterAll(() => {
    agent.kill()
    rmSync(dir, { recursive: true, force: true })
  })

  test('refuses a request without its token', async () => {
    expect((await call('/health', {}, 'wrong')).status).toBe(401)
  })

  test('starts a process under a key and reports it alive', async () => {
    const { pid } = (await (
      await call('/spawn', { key: 'sleeper', command: ['sleep', '30'] })
    ).json()) as { pid: number }
    const alive = (await (await call('/alive', { key: 'sleeper' })).json()) as {
      pid: number
      alive: boolean
    }
    expect(alive).toEqual({ pid, alive: true })
    process.kill(pid)
  })

  test('forgets a process once it exits, so a reused pid is not taken for it', async () => {
    await call('/spawn', { key: 'brief', command: ['true'] })
    await waitFor(
      'the exited process to be forgotten',
      async () =>
        ((await (await call('/alive', { key: 'brief' })).json()) as { pid: number | null }).pid ===
        null,
      { timeoutMs: 5_000, intervalMs: 50 },
    )
  })

  test('keeps answering after it is asked to start a program that does not exist', async () => {
    const res = await call('/spawn', { key: 'missing', command: ['/no/such/program'] })
    expect(res.status).toBe(500)
    await Bun.sleep(200)
    expect((await call('/health')).status).toBe(200)
  })

  test('reads the last lines of a file, and nothing for one not written yet', async () => {
    const file = join(dir, 'log.txt')
    writeFileSync(file, 'one\ntwo\nthree\n')
    const read = async (path: string) =>
      ((await (await call('/read', { path, lines: 2 })).json()) as { text: string }).text
    expect(await read(file)).toBe('two\nthree\n')
    expect(await read(join(dir, 'missing.txt'))).toBe('')
    // A last line still being written has no newline yet.
    writeFileSync(file, 'one\ntwo\nthree')
    expect(await read(file)).toBe('two\nthree')
  })

  test('queries a database read-only', async () => {
    const path = join(dir, 'data.db')
    const db = new Database(path)
    db.exec("CREATE TABLE files (name TEXT); INSERT INTO files VALUES ('a.txt')")
    db.close()
    const res = await call('/sql', { path, query: 'SELECT name FROM files' })
    expect(((await res.json()) as { rows: unknown[] }).rows).toEqual([{ name: 'a.txt' }])
    const write = await call('/sql', { path, query: "INSERT INTO files VALUES ('b')" })
    expect(write.status).toBe(500)
    const copy = join(dir, 'copy.db')
    const vacuum = await call('/sql', { path, query: `VACUUM INTO '${copy}'` })
    expect(vacuum.status).toBe(500)
    // SQLite creates the file before it refuses the write, so it is left empty.
    expect(existsSync(copy) ? statSync(copy).size : 0).toBe(0)
  })
})
