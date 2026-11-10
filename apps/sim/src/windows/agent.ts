/**
 * The sim agent, which runs inside the Windows VM in the test account's
 * desktop session. A process started over SSH runs in session 0, which has no
 * desktop, so Electron's windows, the tray and screenshots do not work there.
 * A logon scheduled task starts this server in the signed-in session instead,
 * and sim asks it over HTTP to start, stop and read the processes that have to
 * live there.
 *
 * It is copied on its own to the VM and run with `bun agent.ts`, so it imports
 * nothing from the repo. Every request carries the token in `token` beside
 * this file, written when the VM was set up, as `x-sim-token`.
 */
import { Database } from 'bun:sqlite'
import { spawn, spawnSync } from 'node:child_process'
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createConnection, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const HERE = import.meta.dir
const PORT = Number(process.env.SIM_AGENT_PORT ?? 47800)
const TOKEN = Buffer.from(readFileSync(join(HERE, 'token'), 'utf8').trim())
/** Sim compares this with the hash of its own copy and replaces a stale agent. */
const VERSION = createHash('sha256')
  .update(readFileSync(import.meta.path))
  .digest('hex')

/** Processes this agent started, by the key sim gave them, so a later request can stop them. */
const started = new Map<string, number>()

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Kills a process and every process it started. Electron runs a GPU, a
 * network and a renderer process under its main one, and `process.kill`
 * stops only the main process, which leaves the others holding the app's
 * single-instance lock.
 */
function killTree(pid: number): void {
  spawnSync('taskkill', ['/T', '/F', '/PID', String(pid)], { windowsHide: true })
}

type SpawnRequest = {
  key: string
  command: string[]
  cwd?: string
  env?: Record<string, string>
  /** Where stdout and stderr go. The process outlives this agent, so they cannot be pipes. */
  log?: string
}

/**
 * Kills every process whose command line contains `match`, and what each
 * started. For a process this agent started before it last restarted, which
 * it no longer knows by key.
 */
async function killMatching(match: string): Promise<number> {
  const script = `$m = $env:SIM_KILL_MATCH
$p = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($m) -and $_.ProcessId -ne $PID }
$p | ForEach-Object { taskkill /T /F /PID $_.ProcessId | Out-Null }
[Console]::Out.Write(@($p).Count)`
  const out = await exec({
    command: ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', script],
    env: { SIM_KILL_MATCH: match },
  })
  return Number(out.stdout) || 0
}

function spawnDetached(req: SpawnRequest): number {
  const previous = started.get(req.key)
  if (previous && alive(previous)) killTree(previous)
  let fd: number | 'ignore' = 'ignore'
  if (req.log) {
    mkdirSync(dirname(req.log), { recursive: true })
    fd = openSync(req.log, 'a')
  }
  const child = spawn(req.command[0], req.command.slice(1), {
    cwd: req.cwd,
    env: { ...process.env, ...req.env },
    detached: true,
    stdio: ['ignore', fd, fd],
    windowsHide: false,
  })
  // A command that cannot start emits 'error' after this returns, and an
  // 'error' with no listener would take the agent down with it.
  child.on('error', (e) => console.error(`spawn ${req.command[0]} failed: ${e.message}`))
  if (typeof fd === 'number') closeSync(fd)
  child.unref()
  if (!child.pid) throw new Error(`Could not start ${req.command[0]}`)
  const pid = child.pid
  started.set(req.key, pid)
  // Forgotten once it exits, since Windows can give its pid to an unrelated
  // process, which `/alive` would then report and `/kill` would end. A later
  // spawn under the same key has a pid of its own and stays.
  child.on('exit', () => {
    if (started.get(req.key) === pid) started.delete(req.key)
  })
  return pid
}

type ExecRequest = {
  command: string[]
  cwd?: string
  env?: Record<string, string>
  timeoutMs?: number
}

/**
 * Runs a command to its end and returns what it printed. Asynchronous, so a
 * long command, such as a build, leaves the agent answering everything else.
 */
async function exec(req: ExecRequest) {
  const proc = Bun.spawn(req.command, {
    cwd: req.cwd,
    env: { ...process.env, ...req.env },
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: req.timeoutMs ?? 60_000,
    windowsHide: true,
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { exitCode, stdout, stderr }
}

/**
 * The whole virtual screen as a PNG, through .NET's screen copy, which works
 * only in a session with a desktop. That is the reason this runs here and
 * not over SSH.
 */
const SCREENSHOT_SCRIPT = `
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
[void][System.Windows.Forms.SystemInformation]
$b = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size)
$ms = New-Object System.IO.MemoryStream
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
[Console]::Out.Write([Convert]::ToBase64String($ms.ToArray()))
`

async function screenshot(): Promise<Uint8Array<ArrayBuffer>> {
  const out = await exec({
    command: ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', SCREENSHOT_SCRIPT],
    timeoutMs: 30_000,
  })
  if (out.exitCode !== 0) throw new Error(`Screenshot failed: ${out.stderr.trim()}`)
  return new Uint8Array(Buffer.from(out.stdout.trim(), 'base64'))
}

/** The last `lines` lines of a text file, or all of it. Empty when it does not exist yet. */
async function readText(path: string, lines?: number): Promise<string> {
  if (!existsSync(path)) return ''
  const text = await readFile(path, 'utf8')
  if (lines === undefined) return text
  const rows = text.split('\n')
  // A final newline leaves an empty last entry, which is not a line. A file
  // being written can end without one.
  const kept = text.endsWith('\n') ? lines + 1 : lines
  return rows.slice(Math.max(0, rows.length - kept)).join('\n')
}

/**
 * Where a client reaches the daemon serving `sockPath`, as `clientEndpoint`
 * in core's ipcEndpoint.ts reads it: on Windows the pipe named on the first
 * line of the file beside it, with the daemon's secret on the second, and
 * otherwise, or with no such file, the path itself.
 */
function daemonEndpoint(sockPath: string): { address: string; secret: string | null } {
  const file = `${sockPath}.pipe`
  if (process.platform !== 'win32' || !existsSync(file)) return { address: sockPath, secret: null }
  const [name, secret] = readFileSync(file, 'utf8').split(/\r?\n/)
  return name && secret ? { address: name, secret } : { address: sockPath, secret: null }
}

/**
 * Has the server on a Windows pipe answer a fresh nonce with an HMAC under the
 * daemon's secret, as `authenticateServer` in core does, so this never relays
 * a call to a server another account put up under a stale pipe name.
 */
function proveDaemon(socket: Socket, secret: string): Promise<void> {
  const nonce = randomBytes(16).toString('hex')
  const expected = createHmac('sha256', secret).update(nonce).digest('hex')
  return new Promise((resolve, reject) => {
    let buffer = ''
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString()
      const newline = buffer.indexOf('\n')
      if (newline === -1) return
      socket.off('data', onData)
      let proof: unknown
      try {
        proof = JSON.parse(buffer.slice(0, newline))?.result?.proof
      } catch {}
      if (proof === expected) resolve()
      else reject(new Error('The server on the daemon pipe is not the daemon'))
    }
    socket.on('data', onData)
    socket.write(`${JSON.stringify({ id: 'hello', method: 'hello', params: { nonce } })}\n`)
  })
}

/**
 * One request to a daemon's socket, in its newline-delimited JSON framing,
 * as `sendIpcCommand` in node-adapters sends it.
 */
function ipc(
  sockPath: string,
  method: string,
  params: unknown,
  timeoutMs = 60_000,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = `${Date.now()}-${Math.random()}`
    const { address, secret } = daemonEndpoint(sockPath)
    let proven = false
    const socket = createConnection(address, () => {
      const send = () => {
        proven = true
        socket.write(`${JSON.stringify({ id, method, params })}\n`)
      }
      if (!secret) return send()
      proveDaemon(socket, secret).then(send, (e: Error) => {
        clearTimeout(timer)
        socket.destroy()
        reject(e)
      })
    })
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error(`IPC ${method} timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    let buffer = ''
    socket.on('data', (chunk) => {
      if (!proven) return
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        let reply: { id?: string; ok?: boolean; result?: unknown; error?: string }
        try {
          reply = JSON.parse(line)
        } catch {
          continue
        }
        if (reply.id !== id) continue
        clearTimeout(timer)
        socket.end()
        if (reply.ok) resolve(reply.result)
        else reject(new Error(reply.error))
      }
    })
    socket.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
  })
}

/**
 * A read-only query, for the same reason sim's own reader on the Mac opens
 * read-only: a read-write connection closing last checkpoints the WAL, which
 * would do recovery a scenario meant the app to do.
 */
function sql(path: string, query: string, params: unknown[]): unknown[] {
  const db = new Database(path, { readonly: true })
  try {
    db.exec('PRAGMA busy_timeout = 5000')
    // A read-only connection can still write another file, with `VACUUM INTO`.
    db.exec('PRAGMA query_only = 1')
    return db.query(query).all(...(params as never[]))
  } finally {
    db.close()
  }
}

/**
 * Starts a fresh copy of this agent and exits, so sim can replace the file
 * and have the new code running. The copy is a child of this process, so it
 * stays in the same desktop session. It retries its bind until this one has
 * let go of the port.
 */
function restart(): void {
  spawnDetached({
    key: 'agent',
    command: [process.execPath, import.meta.path],
    cwd: HERE,
    // The agent's folder is read-only to the test account it runs as.
    log: join(tmpdir(), 'sia-sim-agent.log'),
    env: { SIM_AGENT_RETRY_BIND: '1' },
  })
  setTimeout(() => process.exit(0), 100)
}

const json = (value: unknown, status = 200) => Response.json(value, { status })

async function handle(req: Request): Promise<Response> {
  const token = Buffer.from(req.headers.get('x-sim-token') ?? '')
  if (token.length !== TOKEN.length || !timingSafeEqual(token, TOKEN)) {
    return json({ error: 'bad token' }, 401)
  }
  const { pathname } = new URL(req.url)
  const body = req.method === 'POST' ? ((await req.json().catch(() => ({}))) as any) : {}
  switch (pathname) {
    case '/health':
      return json({ pid: process.pid, version: VERSION, user: process.env.USERNAME })
    case '/spawn':
      return json({ pid: spawnDetached(body as SpawnRequest) })
    case '/kill': {
      if (body.match) return json({ killed: await killMatching(body.match) })
      const pid: number | undefined = body.pid ?? started.get(body.key)
      if (pid && alive(pid)) killTree(pid)
      if (body.key) started.delete(body.key)
      return json({ killed: pid ? 1 : 0 })
    }
    case '/alive': {
      const pid: number | undefined = body.pid ?? started.get(body.key)
      return json({ pid: pid ?? null, alive: pid ? alive(pid) : false })
    }
    case '/exec':
      return json(await exec(body as ExecRequest))
    case '/read':
      return json({ text: await readText(body.path, body.lines) })
    case '/stat': {
      if (!existsSync(body.path)) return json({ exists: false })
      const s = statSync(body.path)
      return json({ exists: true, size: s.size, mtimeMs: s.mtimeMs })
    }
    case '/ipc':
      return json({ result: await ipc(body.path, body.method, body.params ?? {}, body.timeoutMs) })
    case '/sql':
      return json({ rows: sql(body.path, body.query, body.params ?? []) })
    case '/screenshot':
      return new Response(await screenshot(), { headers: { 'content-type': 'image/png' } })
    case '/restart':
      restart()
      return json({ restarting: true })
    default:
      return json({ error: `No route ${pathname}` }, 404)
  }
}

async function serve(): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      Bun.serve({
        port: PORT,
        // Every interface, since the VM's address on Parallels' shared network
        // is handed out by DHCP. The firewall rule admits only the Mac, and
        // the token keeps out anything else that reaches the port.
        hostname: '0.0.0.0',
        // Bun closes a connection idle for 10s by default, and `/exec` and
        // `/ipc` wait on their command for as long as its own timeout.
        idleTimeout: 0,
        fetch: (req) => handle(req).catch((e) => json({ error: String(e?.message ?? e) }, 500)),
      })
      console.log(`agent ${VERSION.slice(0, 12)} listening on ${PORT} as pid ${process.pid}`)
      return
    } catch (e) {
      if (!process.env.SIM_AGENT_RETRY_BIND || attempt > 50) throw e
      await Bun.sleep(200)
    }
  }
}

await serve()
