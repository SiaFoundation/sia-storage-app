/**
 * Servers sim runs in the background, detached so they outlive the command
 * that started them: the mock network per session, and Metro and Appium per
 * checkout. Each is recorded as `{ port, pid }` in a JSON file and counts as
 * running only while it answers its probe on that port. A recorded pid alone
 * proves nothing once the process is gone, since the OS reuses pids, and a
 * port alone proves nothing once another server has taken it. A server that
 * reports its own pid is matched on both, and the others on the port.
 */
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { withFileLock } from './lock'
import { freePort, isAlive, listensOn } from './process'
import { waitFor } from './wait'

type ServerRecord = { port: number; pid: number }

type ServerSpec = {
  /** Directory for the record, the log and the start lock. */
  dir: string
  name: string
  command: (port: number) => string[]
  cwd?: string
  /** Added to this process's environment. A key set to undefined is removed from it. */
  env?: Record<string, string | undefined>
  /**
   * Whether the server on `port` is up and is this kind of server. A server
   * that reports its pid returns it, and counts only if it is the recorded one.
   */
  probe: (port: number) => Promise<boolean | number>
  /** Runs under the start lock before a new server is spawned. */
  beforeStart?: () => Promise<void>
  startTimeoutMs?: number
}

export class BackgroundServer {
  constructor(private readonly spec: ServerSpec) {}

  private get recordFile(): string {
    return join(this.spec.dir, `${this.spec.name}.json`)
  }

  private get logFile(): string {
    return join(this.spec.dir, `${this.spec.name}.log`)
  }

  private async answers(record: ServerRecord): Promise<boolean> {
    const answer = await this.spec.probe(record.port).catch(() => false)
    return typeof answer === 'number' ? answer === record.pid : answer
  }

  private record(): ServerRecord | null {
    if (!existsSync(this.recordFile)) return null
    return JSON.parse(readFileSync(this.recordFile, 'utf8')) as ServerRecord
  }

  /** The recorded server, if it still answers. */
  private async running(): Promise<ServerRecord | null> {
    const record = this.record()
    return record && (await this.answers(record)) ? record : null
  }

  /** Returns the running server, starting one if none answers. Safe to call from several processes. */
  start(): Promise<ServerRecord> {
    return withFileLock(join(this.spec.dir, `${this.spec.name}.lock`), async () => {
      const existing = await this.running()
      if (existing) return existing
      const timeoutMs = this.spec.startTimeoutMs ?? 60_000
      // A server still running that missed the probe, such as a network busy
      // with a large upload, is waited for rather than replaced: a second
      // network on the same state directory would publish into it alongside
      // the first. One that stays silent is stopped before another starts.
      const recorded = this.record()
      if (recorded && listensOn(recorded.pid, recorded.port)) {
        const answered = await waitFor(
          `${this.spec.name} to answer`,
          () => this.answers(recorded),
          { timeoutMs, intervalMs: 500 },
        ).catch(() => false)
        if (answered) return recorded
        await this.stopUnlocked()
      }
      await this.spec.beforeStart?.()
      mkdirSync(this.spec.dir, { recursive: true })
      // The port it had before, when free, so a client that kept the old
      // address, such as a device started against the last network, still
      // reaches it.
      const port = freePort(recorded?.port)
      // Appended, so a restart after a crash keeps the log saying why.
      const log = openSync(this.logFile, 'a')
      const env: Record<string, string | undefined> = { ...process.env, ...this.spec.env }
      for (const [key, value] of Object.entries(this.spec.env ?? {})) {
        if (value === undefined) delete env[key]
      }
      const child = Bun.spawn(this.spec.command(port), {
        cwd: this.spec.cwd,
        env,
        stdio: ['ignore', log, log],
        detached: true,
      })
      child.unref()
      closeSync(log)
      const record = { port, pid: child.pid }
      writeFileSync(this.recordFile, JSON.stringify(record))
      try {
        await waitFor(`${this.spec.name} to start`, () => this.answers(record), {
          timeoutMs,
          intervalMs: 500,
        })
      } catch (e) {
        // Nothing else knows this process, and a server that never answered
        // is never matched again, so it is stopped here or never.
        killGroup(child.pid)
        rmSync(this.recordFile, { force: true })
        throw e
      }
      return record
    })
  }

  /**
   * Stops the server under the start lock, unless `inUse` says something
   * still needs it. The check runs under the lock too, so a process that
   * registers before calling `start` either keeps the server running or has
   * its `start` wait for the stop and then start a new one, never holding the
   * address of a server stopped under it.
   */
  async stop(inUse?: () => boolean): Promise<void> {
    // Checked first without the lock as well, since every sim command reaps
    // and would otherwise wait out another process's start for nothing.
    if (inUse?.()) return
    await withFileLock(join(this.spec.dir, `${this.spec.name}.lock`), async () => {
      if (!inUse?.()) await this.stopUnlocked()
    })
  }

  /**
   * Stops the server with its whole process group, answering or not: SIGTERM,
   * then SIGKILL if it is still running five seconds later, waiting up to five
   * seconds after each. A recorded pid that no longer runs with the recorded
   * port belongs to some other process by now, so it is left alone and only
   * the record goes.
   */
  private async stopUnlocked(): Promise<void> {
    if (!existsSync(this.recordFile)) return
    const record = JSON.parse(readFileSync(this.recordFile, 'utf8')) as ServerRecord
    if (listensOn(record.pid, record.port)) {
      const exit = (signal: NodeJS.Signals) => {
        killGroup(record.pid, signal)
        return waitFor(`${this.spec.name} to exit`, () => !isAlive(record.pid), {
          timeoutMs: 5_000,
          intervalMs: 100,
        }).catch(() => false)
      }
      if (!(await exit('SIGTERM'))) await exit('SIGKILL')
    }
    rmSync(this.recordFile, { force: true })
  }
}

function killGroup(pid: number, signal: NodeJS.Signals = 'SIGKILL'): void {
  try {
    process.kill(-pid, signal)
  } catch {
    // Already gone.
  }
}

/** A probe for servers that answer `GET /<path>` with any 2xx. */
export function httpProbe(path: string, expect?: (body: string) => boolean) {
  return async (port: number) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      signal: AbortSignal.timeout(2000),
    })
    return res.ok && (!expect || expect(await res.text()))
  }
}
