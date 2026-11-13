/**
 * A device that is the desktop app running in the Windows VM: Electron from
 * this checkout's source, built in the VM, the daemon it starts, also from
 * source, and the provider process behind its File Explorer folder.
 * `explorer*` acts on that folder with ordinary file operations made in the
 * VM, which reach the provider through Windows' Cloud Files, the path a
 * person's File Explorer takes.
 *
 * Each start sends the checkout to the VM, uncommitted work included, and
 * rebuilds what changed, so starting the device again picks up an edit made
 * on the Mac. Calls, queries and logs go through the agent in the VM's desktop
 * session, which reaches the daemon's socket and files there.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { leaseHolder, releaseLease, takeLease } from '../desktop-lock'
import { networkControl } from '../network'
import { defaultSessionName, REPO_ROOT, type Session } from '../session'
import { waitFor } from '../wait'
import { GUEST, psQuote, TEST_USER, VM_NAME, WindowsHost } from '../windows/host'
import { parallelsInstalled } from '../windows/vm'
import { inputKey, snapshotWorkingTree, syncCheckout } from '../windows/sync'
import { desktopIdentity } from './desktop'
import { LIBRARY_QUERY, toLibrary } from './library'
import type { Device, LibraryEntry } from './types'

/**
 * What Windows holds for a file in the File Explorer folder, which is what
 * File Explorer draws the file's status icon from.
 */
export type ExplorerState = {
  size: number | null
  directory: boolean
  /** Its bytes are not on the PC, the cloud icon. */
  cloudOnly: boolean
  /** Always keep on this device, the filled green circle. */
  pinned: boolean
  /** Free up space was chosen, so Windows may drop the bytes again. */
  unpinned: boolean
  /** A Cloud Files placeholder. A plain file in the folder shows sync-pending. */
  placeholder: boolean
  /** The tick when set, the sync-pending arrows when not. */
  inSync: boolean
  /** The placeholder's file identity, the item id and version the provider gave it. */
  identity: string | null
}

/**
 * What every app and daemon a Windows device starts has in its command line,
 * and nothing else in the VM does. The VM's desktop runs one device at a time
 * under the lease, so stopping a device stops everything matching it,
 * including a copy an earlier start or another checkout left running, which
 * would otherwise hold the app's single-instance lock.
 */
const DEVICE_PROCESSES = 'D:\\sia\\worktrees\\'

const LEASE_CONTEXT = `windows-${VM_NAME}`

/** The identity the app runs under from source, which names its folder and its mount. */
const IDENTITY = desktopIdentity('dev')

/** Why no Windows device can run on this machine, or null when one can. */
export async function windowsUnavailable(): Promise<string | null> {
  if (!parallelsInstalled()) return 'Windows devices need Parallels Desktop Pro.'
  if ((await new WindowsHost().vm.state()) === 'missing') {
    return `There is no VM named ${VM_NAME}. Run \`bun sim windows create <iso>\` once.`
  }
  return null
}

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

  /** The app's File Explorer folder, or a path inside it. */
  explorerPath(path = ''): string {
    const folder = `C:\\Users\\${TEST_USER}\\${IDENTITY.domainDisplay}`
    return path ? `${folder}\\${path.replace(/\//g, '\\')}` : folder
  }

  /**
   * Unregisters the folder with Windows and deletes it, by the provider's
   * own `remove`, so a device starts with none of what an earlier one listed
   * or downloaded. Run while no app is, since a provider still connected to
   * the folder keeps Windows from letting it go.
   */
  private async removeFolder(): Promise<void> {
    const out = await this.host.agent<{ exitCode: number; stderr: string }>('/exec', {
      command: [
        GUEST.bun,
        `${this.worktree}\\apps\\desktop\\native\\windows\\provider\\main.ts`,
        'remove',
        this.explorerPath(),
        IDENTITY.domainId,
      ],
      cwd: this.worktree,
    })
    if (out.exitCode !== 0) {
      throw new Error(`Removing ${this.name}'s File Explorer folder failed: ${out.stderr.trim()}`)
    }
    // The provider leaves a file the daemon was never sent, such as one a
    // scenario was still uploading when it ended, and the next device would
    // take what is left for files made in its own folder.
    const left = await this.host.agent<{ exists: boolean }>('/stat', { path: this.explorerPath() })
    if (left.exists) await this.host.agent('/file/remove', { path: this.explorerPath() })
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
  async cli(...args: string[]): Promise<string> {
    const networkUrl = await this.vmNetworkUrl()
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
    const first = !this.session.state.devices[this.name]?.prepared
    if (first) {
      await this.host.mustPs(
        `if (Test-Path ${psQuote(this.dir)}) { Remove-Item -Recurse -Force ${psQuote(this.dir)} }`,
        `Clearing ${this.name}'s folder`,
      )
    }
    await this.build(commit)
    // After the build, since the provider that removes the File Explorer
    // folder runs from the worktree's source.
    if (first) {
      await this.removeFolder()
      await this.session.update((s) => {
        s.devices[this.name].prepared = true
      })
    }
    const signedIn = await this.host.agent<{ exists: boolean }>('/stat', {
      path: `${this.dataDir}\\secrets.json`,
    })
    if (!signedIn.exists) await this.cli('connect')
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
    // The app tells the daemon of the folder once the provider serves it. A
    // file saved in the folder before that is sent to a daemon that does not
    // yet record what File Explorer holds.
    await waitFor(
      `${this.name}'s File Explorer folder`,
      async () => (await this.call('settings.getMount')) !== null,
      { timeoutMs: 60_000, intervalMs: 500 },
    )
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

  /**
   * Kills the daemon and leaves the app and its provider running, as a
   * daemon that crashed does. The app starts another.
   */
  async killDaemon(): Promise<void> {
    const lock = await this.host.agent<{ text: string }>('/read', {
      path: `${this.dataDir}\\daemon.lock`,
    })
    await this.host.agent('/kill', { pid: Number.parseInt(lock.text, 10) })
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
   * Stops the app, removes its File Explorer folder, deletes the device's
   * folder in the VM and frees the VM's desktop for the next session, when
   * this session holds it.
   */
  async dispose(): Promise<void> {
    if (this.holdsLease()) {
      try {
        await this.stop().catch(() => {})
        if (await this.vmRunning()) {
          await this.removeFolder().catch(() => {})
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

  /** Names in a directory of the File Explorer folder. */
  async explorerList(dir = ''): Promise<string[]> {
    const { names } = await this.host.agent<{ names: string[] }>('/file/list', {
      path: this.explorerPath(dir),
    })
    return names
  }

  /** Reads a file through File Explorer's folder, which downloads it first when it is not on the PC. */
  async explorerRead(path: string, timeoutMs = 120_000): Promise<Uint8Array> {
    const bytes = await this.host.agent<ArrayBuffer>(
      '/file/read',
      { path: this.explorerPath(path) },
      timeoutMs,
    )
    return new Uint8Array(bytes)
  }

  /**
   * The SHA-256 of a file read through the folder in the VM, for a file too
   * large to bring to this Mac to hash.
   */
  async explorerHash(path: string, timeoutMs = 10 * 60_000): Promise<string> {
    const { sha256 } = await this.host.agent<{ sha256: string }>(
      '/file/hash',
      { path: this.explorerPath(path) },
      timeoutMs,
    )
    return sha256
  }

  /** The bytes the VM's `C:` drive has written since it started, by Windows' own counter. */
  async diskWritten(): Promise<number> {
    const out = await this.host.agent<{ stdout: string }>('/exec', {
      command: [
        'powershell.exe',
        '-NoProfile',
        '-Command',
        "(Get-CimInstance Win32_PerfRawData_PerfDisk_LogicalDisk | Where-Object Name -eq 'C:').DiskWriteBytesPersec",
      ],
    })
    return Number(out.stdout.trim())
  }

  async explorerWrite(path: string, bytes: Uint8Array): Promise<void> {
    await this.host.agent('/file/write', {
      path: this.explorerPath(path),
      base64: Buffer.from(bytes).toString('base64'),
    })
  }

  async explorerRename(from: string, to: string): Promise<void> {
    await this.host.agent('/file/rename', {
      from: this.explorerPath(from),
      to: this.explorerPath(to),
    })
  }

  async explorerRemove(path: string): Promise<void> {
    await this.host.agent('/file/remove', { path: this.explorerPath(path) })
  }

  /** Deletes a file in the folder as File Explorer's Delete does, by moving it to the Recycle Bin. */
  async explorerRecycle(path: string): Promise<void> {
    const out = await this.host.agent<{ exitCode: number; stderr: string }>('/exec', {
      command: [
        'powershell.exe',
        '-NoProfile',
        '-Command',
        `$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName Microsoft.VisualBasic
[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($env:SIM_FILE, 'OnlyErrorDialogs', 'SendToRecycleBin')`,
      ],
      env: { SIM_FILE: this.explorerPath(path) },
    })
    if (out.exitCode !== 0) {
      throw new Error(`Moving ${path} to the Recycle Bin failed: ${out.stderr.trim()}`)
    }
  }

  /** The attribute letters `attrib` prints for a file in the folder. */
  private async attrib(path: string): Promise<string> {
    const target = this.explorerPath(path)
    const { stdout } = await this.host.agent<{ stdout: string }>('/exec', {
      command: ['attrib.exe', target],
    })
    // attrib exits 0 for a file it cannot find, and prints that in place of the attributes.
    if (!stdout.includes(target)) throw new Error(`attrib ${path} failed: ${stdout.trim()}`)
    return stdout.slice(0, stdout.indexOf(target))
  }

  /** Whether a file in the folder is a placeholder whose bytes are not on the PC. */
  async isCloudOnly(path: string): Promise<boolean> {
    return (await this.attrib(path)).includes('O')
  }

  /** What File Explorer shows for each file, read through the agent in one call. */
  async explorerStates(paths: string[]): Promise<ExplorerState[]> {
    const { states } = await this.host.agent<{
      states: ({ path: string; exists: false } | (ExplorerState & { path: string; exists: true }))[]
    }>('/file/state', { paths: paths.map((p) => this.explorerPath(p)) })
    return states.map((state, i) => {
      if (!state.exists)
        throw new Error(`${paths[i]} is not in ${this.name}'s File Explorer folder`)
      const { path: _path, exists: _exists, ...rest } = state
      return rest
    })
  }

  /** What File Explorer shows for a file: its size, where its bytes are, its pin and its sync icon. */
  async explorerState(path: string): Promise<ExplorerState> {
    return (await this.explorerStates([path]))[0]
  }

  /**
   * Chooses a command from the menu File Explorer shows for a file, by the
   * name the menu gives it, and fails when the menu has none by that name.
   * The shell runs the command on the calling thread's message loop, so the
   * script keeps one going for two seconds.
   */
  private async chooseFromMenu(path: string, command: string): Promise<void> {
    const target = this.explorerPath(path)
    const out = await this.host.agent<{ exitCode: number; stderr: string }>('/exec', {
      command: [
        'powershell.exe',
        '-NoProfile',
        '-Command',
        `$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$file = Get-Item -LiteralPath $env:SIM_FILE
$verb = (New-Object -ComObject Shell.Application).Namespace($file.DirectoryName).ParseName($file.Name).Verbs() |
  Where-Object Name -eq $env:SIM_COMMAND
if (-not $verb) { throw 'no such command' }
$verb.DoIt()
$end = (Get-Date).AddSeconds(2)
while ((Get-Date) -lt $end) { [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 50 }`,
      ],
      env: { SIM_FILE: target, SIM_COMMAND: command },
    })
    if (out.exitCode !== 0) {
      throw new Error(`File Explorer's menu has no "${command}" for ${path}: ${out.stderr.trim()}`)
    }
  }

  /** Chooses Free up space for a file in File Explorer's menu. */
  async freeUpSpace(path: string): Promise<void> {
    await this.chooseFromMenu(path, 'Free up space')
  }

  /** Chooses Always keep on this device for a file in File Explorer's menu. */
  async keepOnDevice(path: string): Promise<void> {
    await this.chooseFromMenu(path, 'Always keep on this device')
  }

  async isKeptOnDevice(path: string): Promise<boolean> {
    return (await this.attrib(path)).includes('P')
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

  /** The provider's log, beside the daemon's, which says what it did with the folder. */
  async providerLog(lines = 50): Promise<string> {
    return (
      await this.host.agent<{ text: string }>('/read', {
        path: `${this.dataDir}\\provider.log`,
        lines,
      })
    ).text
  }

  /**
   * Opens the File Explorer folder in an Explorer window, in front of the
   * app, so a screenshot shows each file's status icon. The VM is a test
   * machine with nothing else on its screen.
   */
  async show(): Promise<string> {
    await this.host.agent('/spawn', {
      key: `${this.name}:explorer`,
      command: ['explorer.exe', this.explorerPath()],
    })
    return `${this.name}'s File Explorer folder is open in ${VM_NAME}. \`device screenshot ${this.name} <file>\` captures it.`
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

  /**
   * The app's, the provider's and the daemon's logs, and the folder's top
   * level as text, each entry with what File Explorer shows for it.
   */
  async captureMore(dir: string): Promise<void> {
    writeFileSync(join(dir, 'desktop.log'), await this.appLog(500).catch(() => ''))
    writeFileSync(join(dir, 'provider.log'), await this.providerLog(500).catch(() => ''))
    writeFileSync(join(dir, 'daemon.log'), await this.logs(500).catch(() => ''))
    let entries: unknown
    try {
      const names = await this.explorerList()
      const states = await this.explorerStates(names)
      entries = names.map((name, i) => ({ name, ...states[i] }))
    } catch (e) {
      entries = { error: e instanceof Error ? e.message : String(e) }
    }
    writeFileSync(join(dir, 'explorer.json'), `${JSON.stringify(entries, null, 2)}\n`)
  }

  /**
   * Keeps the logs and the folder's state for a failed run, since the
   * device's folder in the VM is deleted when the device is handed back.
   */
  async preserve(dir: string): Promise<void> {
    if (!(await this.vmRunning())) return
    mkdirSync(dir, { recursive: true })
    await this.captureMore(dir)
    await this.screenshot(join(dir, 'screen.png')).catch(() => {})
  }
}
