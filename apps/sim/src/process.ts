/** Small process helpers shared across sim. */
import { readFileSync } from 'node:fs'

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Whether `pid` is a CLI daemon running on `dataDir`, read from its command
 * line and environment. A daemon killed with SIGKILL leaves its pid file
 * behind, and by the time anything reads it the OS may have given the pid to
 * an unrelated process.
 */
export function isCliDaemon(pid: number, dataDir: string): boolean {
  if (!isAlive(pid)) return false
  const words = commandAndEnvironment(pid)
  return (
    words.some((w) => w.endsWith('apps/cli/src/index.ts')) &&
    words.includes(`SIA_DATA_DIR=${dataDir}`)
  )
}

/** Whether `pid` runs with `--port <port>` among its arguments. */
export function listensOn(pid: number, port: number): boolean {
  if (!isAlive(pid)) return false
  const words = commandAndEnvironment(pid)
  return words.some((w, i) => w === '--port' && words[i + 1] === String(port))
}

/** Linux exposes both under /proc. macOS has no /proc, and its `ps eww` prints the environment after the command. */
function commandAndEnvironment(pid: number): string[] {
  try {
    const read = (file: string) => readFileSync(`/proc/${pid}/${file}`, 'utf8').split('\0')
    return [...read('cmdline'), ...read('environ')]
  } catch {
    const ps = Bun.spawnSync(['ps', 'eww', '-o', 'command=', '-p', String(pid)])
    return ps.stdout.toString().split(/\s+/)
  }
}

/**
 * A free TCP port on 127.0.0.1, found by binding one and releasing it:
 * `preferred` when it is free, and any other otherwise.
 */
export function freePort(preferred = 0): number {
  const bind = (port: number) => {
    const server = Bun.listen({ hostname: '127.0.0.1', port, socket: { data() {} } })
    const bound = server.port
    server.stop(true)
    return bound
  }
  try {
    return bind(preferred)
  } catch {
    return bind(0)
  }
}

export type ProcessSample = { cpu: number; rssMb: number }

/** One `ps` reading of a host process: CPU percent and resident memory. */
export function psSample(pid: number): ProcessSample | null {
  const out = Bun.spawnSync(['ps', '-o', '%cpu=,rss=', '-p', String(pid)])
    .stdout.toString()
    .trim()
  const [cpu, rssKb] = out.split(/\s+/).map(Number)
  return Number.isFinite(cpu) && Number.isFinite(rssKb) ? { cpu, rssMb: rssKb / 1024 } : null
}

/**
 * Runs a command and returns its stdout. Every tool sim drives can block
 * forever on a wedged simulator or emulator, so each run has a deadline. A
 * command past it, or one that exits nonzero unless `check` is false, throws
 * with what it wrote to stderr, named by `name` or its arguments.
 */
export async function runTool(
  args: string[],
  opts: {
    timeoutMs: number
    check?: boolean
    env?: Record<string, string | undefined>
    name?: string
  },
): Promise<Uint8Array> {
  const proc = Bun.spawn(args, {
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: opts.timeoutMs,
    env: opts.env,
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).arrayBuffer(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  const command = opts.name ?? args.join(' ')
  if (proc.signalCode) throw new Error(`${command} did not finish within ${opts.timeoutMs}ms`)
  if (exitCode !== 0 && opts.check !== false) {
    const why = (stderr || new TextDecoder().decode(stdout)).trim().slice(0, 400)
    throw new Error(`${command} failed: ${why || `exit code ${exitCode}`}`)
  }
  return new Uint8Array(stdout)
}
