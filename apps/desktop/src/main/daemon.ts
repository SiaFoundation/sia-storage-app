/*
 * Starting and finding siastoraged.
 *
 * A sibling process, never a child of a window, so a renderer crash cannot take
 * sync down. It outlives the app, so the one serving when the app launches can
 * be from an earlier install. `reconcile` asks it which build it is and who
 * started it, replaces one an earlier desktop install left behind, and asks
 * before stopping any other. `attach` then reports shell-socket readiness
 * separately from reachability.
 *
 * Ownership of a daemon this run did not start comes from the daemon's own
 * report of who started it, never from the shell socket: the daemon answers
 * `ping` before it binds that socket, so inferring it there would strand our
 * own.
 */

import { createRemoteAppService } from '@siastorage/core/app'
import { app } from 'electron'
import { spawn } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { DesktopConfig } from './config'
import { log } from './log'
import { buildVariant, daemonLogPath, daemonSocketPath, dataDir } from './paths'
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

/** What a daemon's `version` call reports about itself. */
export type DaemonIdentity = {
  /** Null for a daemon not packaged inside the desktop app. */
  build: string | null
  version: string
  pid: number
  startedBy: 'desktop' | 'cli'
}

/**
 * What to do with the daemon already serving when the app launches.
 *
 * A daemon from this exact build is kept, and so is any daemon when the app has
 * no build to hold it to. One that an earlier desktop install started is
 * replaced. The rest were started from a terminal, or cannot say who started
 * them because they predate the `version` call or did not answer it in time,
 * so they are stopped only if the user agrees.
 */
export function daemonAction(
  expected: string | undefined,
  running: DaemonIdentity | null,
): 'keep' | 'replace' | 'ask' {
  if (expected === undefined || running?.build === expected) return 'keep'
  return running?.startedBy === 'desktop' ? 'replace' : 'ask'
}

/**
 * The build the daemon serving must report. None when `SIA_DAEMON_SCRIPT`
 * names another script, as sim and a checkout do: that script was not built
 * with this app, and holding it to the app's build would replace the daemon
 * on every launch, including one that survived the app crashing.
 */
export function expectedDaemonBuild(
  config: DesktopConfig,
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  return env.SIA_DAEMON_SCRIPT ? undefined : config.daemonBuild
}

/** How long a replaced daemon gets to finish its in-flight batch and release its lock. */
const REPLACE_TIMEOUT_MS = 30_000

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
  private adopted = false

  /**
   * True once this app has launched the daemon itself, has kept one at launch
   * that a desktop app started, as a crash or a force quit leaves behind, or
   * has told the one serving at launch to make way for its own. Quitting stops
   * an owned daemon and a dead one is revived.
   */
  get owned(): boolean {
    return this.startedHere || this.adopted
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

  /** Null when nothing answers, or when the daemon predates the `version` call. */
  static async identify(): Promise<DaemonIdentity | null> {
    try {
      const reply = (await call('version', [], 3_000)) as Partial<DaemonIdentity> | null
      if (reply?.startedBy !== 'desktop' && reply?.startedBy !== 'cli') return null
      return {
        build: typeof reply.build === 'string' ? reply.build : null,
        version: String(reply.version),
        pid: Number(reply.pid),
        startedBy: reply.startedBy,
      }
    } catch {
      return null
    }
  }

  /**
   * Whether a live daemon still holds `daemon.lock`. The daemon closes its
   * socket before it closes the database and unlinks the lock, so an
   * unreachable socket is not yet a finished shutdown. The lock file holds
   * the owner's pid, and a dead owner means a crash leftover, which must not
   * count as held.
   */
  static holdsLock(): boolean {
    try {
      const pid = Number.parseInt(readFileSync(join(dataDir(), 'daemon.lock'), 'utf8'), 10)
      if (!Number.isInteger(pid)) return false
      // Signal 0 delivers nothing; it only reports whether the pid exists.
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }

  /** Polls the lock out. False if a live daemon still holds it at the deadline. */
  static async lockReleased(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (!Daemon.holdsLock()) return true
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    return !Daemon.holdsLock()
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
   * Makes sure the daemon serving, if any, is this build's before the app
   * attaches. One that is not is shut down unless the user declines, so the
   * `attach` after this finds nothing and starts the bundled daemon.
   *
   * A daemon still finishing uploads when the timeout runs out may yet answer
   * `ping`, so `attach` starts nothing, or may have closed its socket with the
   * lock still held, so the one `attach` starts exits on the lock. Either way
   * the app owns the daemon from the moment it asks for the shutdown, and the
   * revive path starts ours once the old one is gone. Without that ownership
   * revive would skip it, and the app and Finder would have no daemon until
   * the next launch.
   */
  async reconcile(
    expected: string | undefined,
    confirm: (running: DaemonIdentity | null) => Promise<boolean>,
    timeoutMs = REPLACE_TIMEOUT_MS,
  ): Promise<void> {
    // A held lock with no answer on the socket is a daemon exiting, which
    // closes its socket before it releases the lock, or one starting, which
    // takes the lock before it opens the socket. The daemon `attach` would
    // start meanwhile exits on that lock, so this waits for whichever comes
    // first, and an answer means there is a daemon to identify after all.
    const deadline = Date.now() + timeoutMs
    let reachable = await Daemon.isReachable()
    while (!reachable && Daemon.holdsLock() && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      reachable = await Daemon.isReachable()
    }
    if (!reachable) return
    const running = await Daemon.identify()
    const action = daemonAction(expected, running)
    log.info('daemon', 'build_check', {
      expected: expected ?? 'unstamped',
      running: running?.build ?? 'unknown',
      startedBy: running?.startedBy ?? 'unknown',
      pid: running?.pid ?? 'unknown',
      action,
    })
    if (action === 'keep') {
      this.adopted = running?.startedBy === 'desktop'
      return
    }
    if (action === 'ask' && !(await confirm(running))) {
      log.info('daemon', 'kept_mismatched', { running: running?.build ?? 'unknown' })
      return
    }
    this.adopted = true
    // The reply may never arrive, for the reason `stop` gives.
    await call('shutdown', [], 3_000).catch(() => {})
    if (await Daemon.lockReleased(timeoutMs)) {
      log.info('daemon', 'replaced', { previous: running?.build ?? 'unknown' })
    } else {
      log.error('daemon', 'replace_timed_out', { previous: running?.build ?? 'unknown' })
    }
  }

  /**
   * Stops a daemon this app owns, and waits for it to go. One started from a
   * terminal is left alone.
   *
   * The reply may never arrive: the daemon closes its listener as it exits, and
   * the CLI's own `stop` treats that as success for the same reason. What is
   * waited on is the socket going quiet.
   */
  async stop(timeoutMs = 3_000): Promise<void> {
    if (!this.owned) return
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
    const child = spawn(config.runtime, [config.script], {
      env: {
        ...process.env,
        // The entry the CLI's own background start uses, which logs only to
        // stdout. `daemon start --foreground` goes through the CLI's command
        // setup, which adds a second writer on daemon.log and doubles each line.
        SIA_DAEMON_MODE: '1',
        // How the daemon tells the app on its next launch that the app started
        // it, rather than a person running the same script from a terminal.
        SIA_DAEMON_STARTED_BY: 'desktop',
        // Passed rather than left for the daemon to derive, so the app and the
        // daemon it spawns always name the same library.
        SIA_DATA_DIR: dataDir(),
        // Picks the forced-reset nonce the daemon answers to.
        SIA_BUILD_VARIANT: buildVariant(),
        SIA_PROVIDER_SOCKET: config.shellSocket,
        // What the daemon opens when Finder asks to share while this app is
        // not running. A run from source has no bundle to open.
        ...(app.isPackaged ? { SIA_DESKTOP_APP: resolve(process.execPath, '../../..') } : {}),
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
