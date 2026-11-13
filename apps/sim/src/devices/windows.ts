/**
 * A device that is the desktop app running in the Windows VM: Electron from
 * this checkout's source, built in the VM, and the daemon it starts, also from
 * source. It has no Explorer folder yet, so it runs the way the Mac app runs
 * from source with no Finder folder.
 *
 * Each start sends the checkout to the VM, uncommitted work included, and
 * rebuilds what changed, so starting the device again picks up an edit made
 * on the Mac. Calls, queries and logs go through the agent in the VM's desktop
 * session, which reaches the daemon's socket and files there.
 */
import { writeFileSync } from 'node:fs'
import { leaseHolder, releaseLease, takeLease } from '../desktop-lock'
import { networkControl } from '../network'
import { defaultSessionName, REPO_ROOT, type Session } from '../session'
import { waitFor } from '../wait'
import { GUEST, psQuote, VM_NAME, WindowsHost } from '../windows/host'
import { parallelsInstalled } from '../windows/vm'
import { inputKey, snapshotWorkingTree, syncCheckout } from '../windows/sync'
import { LIBRARY_QUERY, toLibrary } from './library'
import type { Device, LibraryEntry } from './types'

/**
 * What every app and daemon a Windows device starts has in its command line,
 * and nothing else in the VM does. The VM's desktop runs one device at a time
 * under the lease, so stopping a device stops everything matching it,
 * including a copy an earlier start or another checkout left running, which
 * would otherwise hold the app's single-instance lock.
 */
const DEVICE_PROCESSES = 'D:\\sia\\worktrees\\'

const LEASE_CONTEXT = `windows-${VM_NAME}`

/**
 * Stops whatever a Windows device left running in the VM when no session
 * holds the VM's desktop, which `prune --all` runs, and returns what it
 * stopped. A stopped VM has nothing running.
 */
export async function release(): Promise<string[]> {
  if (!parallelsInstalled() || leaseHolder(LEASE_CONTEXT)) return []
  const host = new WindowsHost()
  if ((await host.vm.state()) !== 'running') return []
  try {
    await host.attach()
    const { killed } = await host.agent<{ killed: number }>('/kill', { match: DEVICE_PROCESSES })
    return killed > 0 ? [`Sia Storage in ${VM_NAME}`] : []
  } catch {
    // A VM whose agent does not answer has nothing this could stop.
    return []
  }
}

/** Everything `bun install` reads, by path prefix and name. */
const INSTALL_INPUTS = /(^|\/)package\.json$|^bun\.lock$|^patches\//

function installKey(commit: string): string {
  const listing = Bun.spawnSync(['git', 'ls-tree', '-r', commit], { cwd: REPO_ROOT })
  const lines = listing.stdout
    .toString()
    .split('\n')
    .filter((l) => INSTALL_INPUTS.test(l.split('\t')[1] ?? ''))
  return new Bun.CryptoHasher('sha256').update(lines.join('\n')).digest('hex').slice(0, 16)
}

export class WindowsDevice implements Device {
  readonly kind = 'windows' as const
  private readonly host = new WindowsHost()

  constructor(
    readonly name: string,
    private readonly session: Session,
  ) {}

  private get dir(): string {
    return GUEST.deviceDir(this.session.name, this.name)
  }

  private get dataDir(): string {
    return `${this.dir}\\data`
  }

  private get worktree(): string {
    const worktree = this.session.state.devices[this.name]?.target
    if (!worktree) throw new Error(`${this.name} has not started, so it has no worktree in the VM`)
    return worktree
  }

  /** The daemon's environment, which the CLI and the app hand on to it alike. */
  private env(networkUrl: string): Record<string, string> {
    return {
      SIA_DATA_DIR: this.dataDir,
      SIA_TEST_MODE: '1',
      SIA_MOCK_NETWORK_URL: networkUrl,
      SIA_SIM_DEVICE: this.name,
      NO_COLOR: '1',
      ...(this.session.state.fastTimers ? { EXPO_PUBLIC_SIM_FAST_TIMERS: '1' } : {}),
    }
  }

  /**
   * Runs a `sia` command from the worktree's source as the test account,
   * through the agent. Over SSH the account could not follow the workspace
   * links `bun install` made, for the reason `WindowsHost.ps` gives.
   */
  private async cli(networkUrl: string, ...args: string[]): Promise<string> {
    const out = await this.host.agent<{ exitCode: number; stdout: string; stderr: string }>(
      '/exec',
      {
        command: [GUEST.bun, `${this.worktree}\\apps\\cli\\src\\index.ts`, ...args],
        cwd: this.worktree,
        env: this.env(networkUrl),
        timeoutMs: 120_000,
      },
      130_000,
    )
    if (out.exitCode !== 0) {
      throw new Error(`sia ${args.join(' ')} failed on ${this.name}: ${out.stderr || out.stdout}`)
    }
    return out.stdout
  }

  /**
   * Installs and builds what changed since the last start, with a log under
   * the worktree's `.build-cache/windows-desktop`. A step whose inputs match
   * the key it stamped last time is skipped. On failure the log's tail is
   * printed here.
   */
  private async build(commit: string): Promise<void> {
    const install = installKey(commit)
    const build = `${install}-${inputKey(commit, ['apps/desktop', 'packages', 'tsconfig.json'])}`
    const cache = `${this.worktree}\\.build-cache\\windows-desktop`
    const out = await this.host.ps(
      `
Set-Location ${psQuote(this.worktree)}
$cache = ${psQuote(cache)}
New-Item -ItemType Directory -Force $cache | Out-Null
$log = Join-Path $cache 'build.log'
function Step($name, $key, [scriptblock]$run) {
  $stamp = Join-Path $cache "$name.key"
  if ((Test-Path $stamp) -and ((Get-Content $stamp -Raw).Trim() -eq $key)) { Write-Output "$name unchanged"; return }
  $started = Get-Date
  "== $name $(Get-Date -Format o)" | Out-File -Append $log
  & $run *>> $log
  if ($LASTEXITCODE) { Get-Content $log -Tail 60; throw "$name failed" }
  Set-Content $stamp $key
  Write-Output ("$name {0:n1}s" -f ((Get-Date) - $started).TotalSeconds)
}
# Electron's binary is downloaded by its own install script, which
# \`bun install\` here leaves unrun, as CI's \`desktop:setup\` step finds.
Step 'install' ${psQuote(install)} {
  & ${psQuote(GUEST.bun)} install --frozen-lockfile
  if (-not $LASTEXITCODE) { & ${psQuote(GUEST.bun)} node_modules\\electron\\install.js }
}
Step 'build' ${psQuote(build)} { & ${psQuote(GUEST.bun)} run --cwd apps/desktop build }`,
      30 * 60_000,
    )
    if (out.exitCode !== 0) {
      throw new Error(
        `Building the desktop app in the VM failed:\n${(out.stdout + out.stderr).trim()}`,
      )
    }
    for (const line of out.stdout.trim().split('\n')) console.log(`  ${this.name}: ${line.trim()}`)
  }

  private async vmNetworkUrl(): Promise<string> {
    return networkControl(this.session).listen(await this.host.vm.hostAddress())
  }

  private holdsLease(): boolean {
    return leaseHolder(LEASE_CONTEXT) === this.session.name
  }

  /**
   * The VM's desktop session runs one copy of the app, so the lease comes
   * first, and every app and daemon a device left behind is stopped before
   * the build, since Windows will not replace an executable or a library a
   * running process holds open.
   */
  async start(): Promise<void> {
    await takeLease(LEASE_CONTEXT, 'Sia Storage', this.session.name, {
      waitsFor: `the desktop of the Windows VM ${VM_NAME}`,
    })
    await this.host.ready()
    const networkUrl = await this.vmNetworkUrl()
    const { commit, worktree } = await syncCheckout(this.host, defaultSessionName())
    await this.session.update((s) => {
      s.devices[this.name].target = worktree
    })
    await this.stop()
    // A session's device names reuse the same folder in the VM, so a new
    // device would otherwise start on an earlier one's library and account.
    if (!this.session.state.devices[this.name]?.prepared) {
      await this.host.mustPs(
        `if (Test-Path ${psQuote(this.dir)}) { Remove-Item -Recurse -Force ${psQuote(this.dir)} }`,
        `Clearing ${this.name}'s folder`,
      )
      await this.session.update((s) => {
        s.devices[this.name].prepared = true
      })
    }
    await this.build(commit)
    const signedIn = await this.host.agent<{ exists: boolean }>('/stat', {
      path: `${this.dataDir}\\secrets.json`,
    })
    if (!signedIn.exists) await this.cli(networkUrl, 'connect')
    await this.host.agent('/spawn', {
      key: this.name,
      command: [
        `${worktree}\\node_modules\\electron\\dist\\electron.exe`,
        `${worktree}\\apps\\desktop`,
      ],
      cwd: `${worktree}\\apps\\desktop`,
      env: {
        ...this.env(networkUrl),
        SIA_DAEMON_SCRIPT: `${worktree}\\apps\\cli\\src\\index.ts`,
        SIA_DAEMON_RUNTIME: GUEST.bun,
      },
      log: `${this.dir}\\electron.log`,
    })
    await waitFor(
      `${this.name} daemon to answer`,
      () => this.ipc('ping', {}, 2_000).then(() => true),
      { timeoutMs: 90_000, intervalMs: 1000 },
    ).catch(async (e: unknown) => {
      // The app writes nothing to its own log when it fails before its logger
      // is up, such as a module that does not load on Windows, and then only
      // Electron's stderr says why.
      const read = (path: string) =>
        this.host
          .agent<{ text: string }>('/read', { path, lines: 30 })
          .then((r) => r.text.trim() || '(empty)')
          .catch(() => '(unreadable)')
      throw new Error(
        `${e instanceof Error ? e.message : String(e)}\n` +
          `electron.log:\n${await read(`${this.dir}\\electron.log`)}\n` +
          `desktop.log:\n${await read(`${this.dataDir}\\desktop.log`)}\n` +
          `daemon.log:\n${await read(`${this.dataDir}\\daemon.log`)}`,
      )
    })
    // Recorded only once the app answers, so a start that failed partway is
    // started again by the next `up` rather than taken as current.
    await this.session.update((s) => {
      s.devices[this.name].commit = commit
    })
  }

  async refresh(): Promise<boolean> {
    // A network that died and came back on its old port lost the listener the
    // VM reaches it on, and `up` restarts devices only when the port changed.
    if (await this.vmRunning()) await this.vmNetworkUrl()
    const commit = snapshotWorkingTree(defaultSessionName())
    if (commit === this.session.state.devices[this.name]?.commit) return false
    await this.start()
    return true
  }

  /**
   * Opens the app's main window the way launching it again does: the second
   * copy hands over to the running one, which shows the window, and exits.
   * An app started with an account shows only its tray icon until asked.
   */
  async openWindow(): Promise<void> {
    if (!(await this.isRunning()))
      throw new Error(`${this.name} is not running, so it has no window to open`)
    await this.host.agent('/spawn', {
      key: `${this.name}:open`,
      command: [
        `${this.worktree}\\node_modules\\electron\\dist\\electron.exe`,
        `${this.worktree}\\apps\\desktop`,
      ],
      cwd: `${this.worktree}\\apps\\desktop`,
    })
  }

  private ipc(
    method: string,
    params: Record<string, unknown>,
    timeoutMs = 60_000,
  ): Promise<unknown> {
    return this.host
      .agent<{ result: unknown }>(
        '/ipc',
        { path: `${this.dataDir}\\daemon.sock`, method, params, timeoutMs },
        timeoutMs + 5_000,
      )
      .then((r) => r.result)
  }

  /** Attaches to the VM when it runs, and says whether it does. */
  private async vmRunning(): Promise<boolean> {
    if ((await this.host.vm.state()) !== 'running') return false
    await this.host.attach()
    return true
  }

  /**
   * Asks the daemon to shut down, which ends its uploads cleanly, then stops
   * the app and anything else a device left running.
   */
  async stop(): Promise<void> {
    // The match spans every session's processes, and a session still waiting
    // for the lease would stop the one using the VM.
    if (!this.holdsLease() || !(await this.vmRunning())) return
    // The daemon closes its pipe before it finishes its uploads and closes its
    // database, so a ping that fails does not yet mean it can be killed. Its
    // process exiting does, and the lock file holds its pid.
    const lock = await this.host.agent<{ text: string }>('/read', {
      path: `${this.dataDir}\\daemon.lock`,
    })
    const pid = Number.parseInt(lock.text, 10)
    await this.ipc('shutdown', {}, 5_000).catch(() => {})
    if (pid > 0) {
      await waitFor(
        `${this.name} daemon to exit`,
        async () => !(await this.host.agent<{ alive: boolean }>('/alive', { pid })).alive,
        { timeoutMs: 15_000, intervalMs: 500 },
      ).catch(() => {})
    }
    await this.host.agent('/kill', { match: DEVICE_PROCESSES })
  }

  async kill(): Promise<void> {
    if (!this.holdsLease() || !(await this.vmRunning())) return
    await this.host.agent('/kill', { match: DEVICE_PROCESSES })
  }

  /** Whether the app runs and its daemon answers. */
  async isRunning(): Promise<boolean> {
    try {
      if (!(await this.vmRunning())) return false
      const app = await this.host.agent<{ alive: boolean }>('/alive', { key: this.name })
      return app.alive && (await this.ipc('ping', {}, 2_000).then(() => true))
    } catch {
      return false
    }
  }

  async call<T = unknown>(method: string, ...args: unknown[]): Promise<T> {
    await this.host.attach()
    return (await this.ipc(`ds:${method.split('.').join(':')}`, { args })) as T
  }

  async sql<T = Record<string, unknown>>(query: string, ...params: unknown[]): Promise<T[]> {
    await this.host.attach()
    const { rows } = await this.host.agent<{ rows: T[] }>('/sql', {
      path: `${this.dataDir}\\data.db`,
      query,
      params,
    })
    return rows
  }

  /**
   * Stops the app, deletes the device's folder in the VM and frees the VM's
   * desktop for the next session, when this session holds it.
   */
  async dispose(): Promise<void> {
    if (this.holdsLease()) {
      try {
        await this.stop().catch(() => {})
        if (await this.vmRunning()) {
          await this.host
            .mustPs(
              `if (Test-Path ${psQuote(this.dir)}) { Remove-Item -Recurse -Force ${psQuote(this.dir)} }`,
              'Clearing',
            )
            .catch(() => {})
        }
      } finally {
        releaseLease(LEASE_CONTEXT)
      }
    }
    await this.session.update((s) => {
      delete s.devices[this.name].prepared
    })
  }

  async addFile(): Promise<{ id: string; name: string }> {
    throw new Error(
      `Adding a file from this Mac to ${this.name} in the Windows VM is not built yet`,
    )
  }

  async library(): Promise<LibraryEntry[]> {
    return toLibrary(await this.sql(LIBRARY_QUERY))
  }

  /** The daemon's log, as `logs` reads a Mac desktop device's. The app's is `appLog`. */
  async logs(lines = 50): Promise<string> {
    await this.host.attach()
    const path = `${this.dataDir}\\daemon.log`
    return (await this.host.agent<{ text: string }>('/read', { path, lines })).text
  }

  /** The Electron app's own log, beside the daemon's in its data directory. */
  async appLog(lines = 50): Promise<string> {
    await this.host.attach()
    return (
      await this.host.agent<{ text: string }>('/read', {
        path: `${this.dataDir}\\desktop.log`,
        lines,
      })
    ).text
  }

  /**
   * The VM's desktop as a PNG, taken by the agent in the desktop session. A
   * session that hangs, or an agent that is not running, falls back to the
   * VM's own capture of its display, which can come back black for a moment
   * while a window starts drawing.
   */
  async screenshot(path: string): Promise<void> {
    if ((await this.host.vm.state()) !== 'running') {
      throw new Error(`${VM_NAME} is not running, so there is no screen to capture`)
    }
    try {
      await this.host.attach()
      const png = await this.host.agent<ArrayBuffer>('/screenshot', {}, 30_000)
      writeFileSync(path, new Uint8Array(png))
    } catch {
      await this.host.vm.screenshot(path)
    }
  }

  async captureMore(dir: string): Promise<void> {
    writeFileSync(`${dir}/desktop.log`, await this.appLog(500).catch(() => ''))
  }
}
