/*
 * Starting and finding siastoraged.
 *
 * A sibling process, never a child of a window, so a renderer crash cannot take
 * sync down. One already serving is attached rather than replaced, and `attach`
 * reports shell-socket readiness separately from reachability. Ownership is
 * remembered, not inferred: the daemon answers `ping` before it binds that
 * socket, so inferring it there would strand our own.
 */

import { createRemoteAppService } from '@siastorage/core/app'
import { spawn } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync } from 'node:fs'
import { dirname } from 'node:path'
import { log } from './log'
import { daemonLogPath, daemonSocketPath } from './paths'
import { call } from './rpc'

/** The facade, typed, for this process's own reads. No cache subscription:
 *  nothing here renders, so nothing needs invalidating. */
const facade = createRemoteAppService(
  (channel, args, timeoutMs) => call(channel, args, timeoutMs),
  undefined,
  {
    // Read on a tray click. Each call is bounded at three seconds and the two
    // run in sequence, so a hung daemon degrades to the sign-in window inside
    // six rather than holding the click for the transport default.
    timeouts: { 'ds:settings:getIndexerURL': 3_000, 'ds:auth:hasAppKey': 3_000 },
  },
)

export type DaemonStatus = 'unreachable' | 'running' | 'running-without-shell'

export type DaemonSpawn = {
  /** A script host. Never `process.execPath`: under Electron that is the GUI runtime. */
  runtime: string
  script: string
  shellSocket: string
  /** Only a sandboxed shell needs one, so only macOS passes it. */
  handoffDir?: string
}

export class Daemon {
  private status: DaemonStatus = 'unreachable'
  private startedHere = false

  /** True once this app has launched the daemon itself. */
  get owned(): boolean {
    return this.startedHere
  }

  /**
   * Whether this machine has been paired with its indexer.
   *
   * False when the daemon cannot be asked, which sends the click to the window:
   * signing in is the one thing worth offering when nothing else works.
   */
  static async hasAccount(): Promise<boolean> {
    try {
      return await facade.auth.hasAppKey(await facade.settings.getIndexerURL())
    } catch {
      return false
    }
  }

  static async isReachable(): Promise<boolean> {
    if (!existsSync(daemonSocketPath())) return false
    try {
      // The daemon's own liveness channel, rather than a facade call that also
      // answers for whether one store or another came up.
      await call('ping', [], 3_000)
      return true
    } catch {
      return false
    }
  }

  /**
   * Attaches to a running daemon, starting one only if nothing answers.
   *
   * `running-without-shell` means the facade is up but whoever started it gave
   * it no shell socket, so the OS integration has nothing to talk to. The mount
   * then serves stale cached content rather than failing visibly, which is worth
   * naming rather than reporting as healthy.
   */
  async attach(spawnWith?: DaemonSpawn, attempts = 8, gapMs = 500): Promise<DaemonStatus> {
    let reachable = false
    for (let i = 0; i < attempts; i += 1) {
      reachable = await Daemon.isReachable()
      // A daemon answers `ping` before it binds the shell socket, so a miss is
      // not yet degraded: keep looking for the rest of the window.
      if (reachable && (!spawnWith || existsSync(spawnWith.shellSocket))) {
        this.status = spawnWith ? 'running' : 'running-without-shell'
        return this.status
      }
      if (i === 0 && spawnWith && !reachable) this.start(spawnWith)
      await new Promise((resolve) => setTimeout(resolve, gapMs))
    }
    this.status = reachable ? 'running-without-shell' : 'unreachable'
    return this.status
  }

  /**
   * Stops a daemon this app started, and waits for it to go. One that was
   * already running when the app arrived is left alone.
   *
   * The reply may never arrive: the daemon closes its listener as it exits, and
   * the CLI's own `stop` treats that as success for the same reason. What is
   * waited on is the socket going quiet.
   */
  async stop(timeoutMs = 3_000): Promise<void> {
    if (!this.startedHere) return
    const deadline = Date.now() + timeoutMs
    await call('shutdown', [], timeoutMs).catch(() => {})
    while (Date.now() < deadline) {
      if (!(await Daemon.isReachable())) break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    this.status = 'unreachable'
  }

  private start(config: DaemonSpawn): void {
    // Only checked when it names a path: `SIA_DAEMON_RUNTIME` can point at an
    // interpreter on PATH, and testing a bare command would reject every one.
    if (config.runtime.includes('/') && !existsSync(config.runtime)) {
      log.error('daemon', 'runtime_missing', { runtime: config.runtime })
      return
    }
    if (!existsSync(config.script)) {
      log.error('daemon', 'script_missing', { script: config.script })
      return
    }
    log.info('daemon', 'starting', { runtime: config.runtime })
    this.startedHere = true
    // The daemon logs to stdout, so this redirect is its file: ignoring stdio
    // would leave `daemon.log` empty and a failed start undiagnosable.
    const logPath = daemonLogPath()
    // 0700 because the same directory holds the account secrets, the socket and
    // the database, which is the mode the node adapters create it with.
    mkdirSync(dirname(logPath), { recursive: true, mode: 0o700 })
    const logFd = openSync(logPath, 'a')
    const child = spawn(config.runtime, [config.script, 'daemon', 'start', '--foreground'], {
      env: {
        ...process.env,
        SIA_PROVIDER_SOCKET: config.shellSocket,
        ...(config.handoffDir ? { SIA_HANDOFF_DIR: config.handoffDir } : {}),
      },
      detached: true,
      stdio: ['ignore', logFd, logFd],
    })
    closeSync(logFd)
    // An 'error' event with no listener throws from the main process and takes
    // the app down. Nothing can rescue it here, so it is logged instead.
    child.on('error', (e) => {
      // Ownership goes back: a spawn that never produced a process must not
      // leave this app quitting a daemon someone else started later.
      this.startedHere = false
      log.error('daemon', 'start_failed', { error: e })
    })
    // Outlives this process on purpose: sync should survive the UI quitting.
    child.unref()
  }
}
