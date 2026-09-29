/**
 * A device that is a CLI daemon, which is the same program the desktop app
 * runs in the background. It runs from source in test mode, pointed at the
 * session's network, with its own data directory.
 */
import { readDatabase } from '../sqlite'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readDaemonPid } from '@siastorage/node-adapters/lock'
import { getPaths } from '@siastorage/node-adapters/paths'
import { sendIpcCommand } from '@siastorage/node-adapters/ipc'
import { REPO_ROOT, type Session } from '../session'
import { isAlive, isCliDaemon, type ProcessSample, psSample } from '../process'
import { waitFor } from '../wait'
import { LIBRARY_QUERY, toLibrary } from './library'
import type { Device, LibraryEntry } from './types'

export const CLI_ENTRY = join(REPO_ROOT, 'apps/cli/src/index.ts')

type CliResult = { stdout: string; stderr: string; exitCode: number }

export class CliDevice implements Device {
  readonly kind: 'cli' | 'desktop' = 'cli'
  protected readonly paths: ReturnType<typeof getPaths>

  constructor(
    readonly name: string,
    protected readonly session: Session,
  ) {
    this.paths = getPaths(session.deviceDir(name))
  }

  /** The environment every CLI process of this device runs with. */
  env(): Record<string, string> {
    return {
      ...(process.env as Record<string, string>),
      SIA_DATA_DIR: this.paths.dataDir,
      SIA_TEST_MODE: '1',
      SIA_MOCK_NETWORK_URL: this.session.networkUrl(),
      SIA_SIM_DEVICE: this.name,
      // Where the Finder extension would stage bytes it hands the daemon. With
      // it set, the device serves provider.create, write, fetch and fetchRange,
      // so a scenario can make the calls the extension makes.
      SIA_HANDOFF_DIR: this.handoffDir,
      NO_COLOR: '1',
      ...(this.session.state.fastTimers ? { EXPO_PUBLIC_SIM_FAST_TIMERS: '1' } : {}),
    }
  }

  get handoffDir(): string {
    return join(this.paths.dataDir, 'handoff')
  }

  /**
   * Writes `bytes` into the handoff directory and returns the path, the way the
   * Finder extension stages a file before calling provider.create or write.
   */
  stage(bytes: Uint8Array): string {
    mkdirSync(this.handoffDir, { recursive: true })
    const path = join(this.handoffDir, crypto.randomUUID())
    writeFileSync(path, bytes)
    return path
  }

  /** A fresh path in the handoff directory, for provider.fetch to place bytes at. */
  handoffTarget(): string {
    mkdirSync(this.handoffDir, { recursive: true })
    return join(this.handoffDir, crypto.randomUUID())
  }

  /** Runs any `sia` command as this device, e.g. `cli('mv', 'a.txt', 'docs/')`, for up to 5 minutes. */
  async cli(...args: string[]): Promise<CliResult> {
    const proc = Bun.spawn([process.execPath, CLI_ENTRY, ...args], {
      env: this.env(),
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 5 * 60_000,
    })
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    return { stdout, stderr, exitCode }
  }

  protected async mustCli(...args: string[]): Promise<CliResult> {
    const result = await this.cli(...args)
    if (result.exitCode !== 0) {
      throw new Error(
        `sia ${args.join(' ')} failed on ${this.name}: ${result.stderr || result.stdout}`,
      )
    }
    return result
  }

  async start(): Promise<void> {
    // The Finder extension's container always exists before it hands a path
    // over, and exporting into a missing directory fails.
    mkdirSync(this.handoffDir, { recursive: true })
    if (!existsSync(this.paths.secretsPath)) await this.mustCli('connect')
    await this.mustCli('daemon', 'start')
    await waitFor(`${this.name} daemon to answer`, () => this.ping(), { timeoutMs: 20_000 })
  }

  protected async ping(): Promise<boolean> {
    await sendIpcCommand(this.paths.sockPath, 'ping', {}, 1_000)
    return true
  }

  async stop(): Promise<void> {
    const pid = readDaemonPid(this.paths.pidPath)
    await sendIpcCommand(this.paths.sockPath, 'shutdown', {}, 5_000).catch(() => {})
    if (pid) {
      await waitFor(`${this.name} daemon to exit`, () => !isCliDaemon(pid, this.paths.dataDir), {
        timeoutMs: 15_000,
      })
    }
  }

  async kill(): Promise<void> {
    const pid = readDaemonPid(this.paths.pidPath)
    if (pid && isCliDaemon(pid, this.paths.dataDir)) {
      process.kill(pid, 'SIGKILL')
      await waitFor(`${this.name} daemon to die`, () => !isAlive(pid), { timeoutMs: 5_000 })
    }
  }

  async isRunning(): Promise<boolean> {
    const pid = readDaemonPid(this.paths.pidPath)
    return pid !== null && isCliDaemon(pid, this.paths.dataDir)
  }

  async sampleProcess(): Promise<ProcessSample | null> {
    const pid = readDaemonPid(this.paths.pidPath)
    return pid !== null && isCliDaemon(pid, this.paths.dataDir) ? psSample(pid) : null
  }

  async call<T = unknown>(method: string, ...args: unknown[]): Promise<T> {
    const channel = `ds:${method.split('.').join(':')}`
    return (await sendIpcCommand(this.paths.sockPath, channel, { args }, 60_000)) as T
  }

  async sql<T = Record<string, unknown>>(query: string, ...params: unknown[]): Promise<T[]> {
    return readDatabase<T>(this.paths.dbPath, query, params)
  }

  async addFile(path: string, opts: { dir?: string } = {}): Promise<{ id: string; name: string }> {
    return (await sendIpcCommand(
      this.paths.sockPath,
      'upload',
      { path, directory: opts.dir },
      60_000,
    )) as { id: string; name: string }
  }

  async library(): Promise<LibraryEntry[]> {
    return toLibrary(await this.sql(LIBRARY_QUERY))
  }

  async logs(lines = 50): Promise<string> {
    if (!existsSync(this.paths.logPath)) return ''
    return readFileSync(this.paths.logPath, 'utf8')
      .split('\n')
      .slice(-lines - 1)
      .join('\n')
  }
}
