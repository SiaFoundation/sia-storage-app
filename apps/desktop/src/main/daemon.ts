/*
 * Starting and finding siastoraged.
 *
 * The daemon holds core, the database and the sync engine. It is a sibling
 * process, never a child of a window, so a renderer crash cannot take sync down
 * and closing the window leaves it running.
 *
 * A daemon that is already serving is attached to rather than replaced: two
 * daemons against one data directory is the failure mode to avoid. But an
 * attached daemon is only useful to the OS shell if it was given a shell socket
 * to serve, so `attach` reports that separately from mere reachability.
 *
 * Whose daemon it is, on the other hand, is remembered rather than inferred. The
 * daemon answers `ping` before it binds the shell socket, so a spawn of our own
 * can look like someone else's for a moment, and inferring ownership from the
 * socket in that moment would leave our daemon running after the app quits.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { log } from './log'
import { daemonSocketPath } from './paths'
import { call } from './rpc'

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
      // A daemon answers `ping` before it binds the shell socket, so a miss on
      // the socket is not yet the degraded state. Keep looking for the rest of
      // the window rather than reporting it on the first pass.
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
    if (!existsSync(config.runtime) || !existsSync(config.script)) {
      log.error(`cannot start the daemon: ${config.runtime} or ${config.script} is missing`)
      return
    }
    log.info(`starting the daemon with ${config.runtime}`)
    this.startedHere = true
    const child = spawn(config.runtime, [config.script, 'daemon', 'start', '--foreground'], {
      env: {
        ...process.env,
        SIA_PROVIDER_SOCKET: config.shellSocket,
        ...(config.handoffDir ? { SIA_HANDOFF_DIR: config.handoffDir } : {}),
      },
      detached: true,
      stdio: 'ignore',
    })
    // An 'error' event with no listener throws, and thrown from the main
    // process that takes the app down. Nothing here can rescue a daemon that
    // will not start, so it is logged and the status stays unreachable.
    child.on('error', (e) => log.error(`the daemon did not start: ${e.message}`))
    // Outlives this process on purpose: sync should survive the UI quitting.
    child.unref()
  }
}
