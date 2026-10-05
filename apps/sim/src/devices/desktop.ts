/**
 * A device that is the installed desktop app on this Mac: the Electron app,
 * the daemon it starts, and the File Provider extension behind its Finder
 * folder. The daemon is the CLI's, so every call, query and log a CLI device
 * has works the same here. `finder*` acts on the Finder folder with ordinary
 * file operations, which go through macOS's File Provider framework to the
 * Swift extension and on to the daemon, the path a person's Finder takes and
 * one no other device runs.
 *
 * It launches the build context `SIM_DESKTOP_CONTEXT` names, `test` unless set,
 * installed by `bun run desktop:package test`. That build has bundle ids of its
 * own, so resetting its Finder folder never touches a build someone is using.
 * The daemon runs from source, so a TypeScript change needs no repackaging. A
 * change to the Electron main process or the extension needs the package
 * command again.
 *
 * A build has one Finder folder per Mac, so one desktop device runs at a time
 * across every checkout, under a lease every checkout checks.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { sendIpcCommand } from '@siastorage/node-adapters/ipc'
import { withFileLock } from '../lock'
import { freePort, isAlive } from '../process'
import { REPO_ROOT, SIM_HOME, Session } from '../session'
import { waitFor } from '../wait'
import { CLI_ENTRY, CliDevice } from './cli'
import { DesktopUi } from './desktop-ui'

export type DesktopIdentity = {
  context: string
  appName: string
  domainId: string
  domainDisplay: string
  appPath: string
  /**
   * Where the File Provider extension reaches the daemon, inside the
   * extension's container. Null for a context whose env names no extension.
   */
  providerSocket: string | null
}

/** `KEY=value` lines, skipping comments and blanks, as the build's env files are written. */
export function parseEnvFile(text: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (match) values[match[1]] = match[2]
  }
  return values
}

/**
 * The builds a person uses day to day. A device quits its build and removes
 * that build's Finder folder, so pointing one at these would do that to the
 * person's own app.
 */
const PERSONAL_CONTEXTS = ['prod', 'beta']

/**
 * The identity a build context installs under, read from the same env files
 * packaging reads, the gitignored `<context>.env` over the committed example.
 */
export function desktopIdentity(
  context = process.env.SIM_DESKTOP_CONTEXT ?? 'test',
  envDir = join(REPO_ROOT, 'apps/desktop/env'),
): DesktopIdentity {
  if (PERSONAL_CONTEXTS.includes(context)) {
    throw new Error(
      `SIM_DESKTOP_CONTEXT=${context} would quit that build and remove its Finder folder. Use test or dev.`,
    )
  }
  const example = join(envDir, `${context}.example.env`)
  if (!existsSync(example)) throw new Error(`No desktop build context named ${context}`)
  const local = join(envDir, `${context}.env`)
  const values = {
    ...parseEnvFile(readFileSync(example, 'utf8')),
    ...(existsSync(local) ? parseEnvFile(readFileSync(local, 'utf8')) : {}),
  }
  return {
    context,
    appName: values.SIA_APP_NAME,
    domainId: values.SIA_DOMAIN_ID,
    domainDisplay: values.SIA_DOMAIN_DISPLAY,
    appPath: join('/Applications', `${values.SIA_APP_NAME}.app`),
    providerSocket: values.SIA_EXT_BUNDLE_ID
      ? join(homedir(), 'Library', 'Containers', values.SIA_EXT_BUNDLE_ID, 'Data', 'provider.sock')
      : null,
  }
}

/** Why no desktop device can run on this machine, or null when one can. */
export function desktopUnavailable(identity = desktopIdentity()): string | null {
  if (process.platform !== 'darwin') return 'Desktop devices run only on macOS.'
  if (!existsSync(identity.appPath)) {
    return `${identity.appName} is not installed. Run \`bun run desktop:package ${identity.context}\` once.`
  }
  return null
}

/**
 * The Finder folder, found as the desktop app finds it. The system names it
 * `<app>-<domain display name>` with the whitespace stripped from both, and
 * puts a folder it preserved when a domain was removed beside it with a date
 * appended, which the suffix match leaves out.
 */
export function findMount(
  domainDisplay: string,
  root = join(homedir(), 'Library', 'CloudStorage'),
): string | null {
  const suffix = `-${domainDisplay.replace(/\s+/g, '')}`
  let entries: string[]
  try {
    entries = readdirSync(root)
  } catch {
    return null
  }
  const entry = entries.find((e) => e.endsWith(suffix))
  return entry ? join(root, entry) : null
}

function agentPath(identity: DesktopIdentity): string {
  return join(
    identity.appPath,
    'Contents',
    'Helpers',
    'SiaDomainAgent.app',
    'Contents',
    'MacOS',
    'SiaDomainAgent',
  )
}

type AgentResult = { ok: boolean; domains?: string[]; message?: string; preserved?: string }

/** Runs the app's domain helper, which answers one line of JSON. */
function runAgent(identity: DesktopIdentity, args: string[]): AgentResult {
  const out = Bun.spawnSync([agentPath(identity), ...args], { timeout: 30_000 })
  try {
    return JSON.parse(out.stdout.toString().trim()) as AgentResult
  } catch {
    throw new Error(
      `SiaDomainAgent ${args[0]} failed: ${out.stderr.toString().trim().slice(0, 300)}`,
    )
  }
}

/**
 * Removes the build's Finder folder, and with it everything the system cached
 * for it. When the folder holds changes the extension has not synced, macOS
 * keeps them in a dated folder beside it and the agent returns that path. A
 * device's folder holds only test data, so that copy is deleted as well, or
 * each reset would leave one in ~/Library/CloudStorage.
 */
function removeDomain(identity: DesktopIdentity): void {
  if (!runAgent(identity, ['list']).domains?.includes(identity.domainId)) return
  const result = runAgent(identity, ['unregister', identity.domainId])
  if (!result.ok) throw new Error(`Could not remove the ${identity.domainDisplay} Finder folder`)
  if (!result.preserved) return
  // The path comes from the agent's output, so it is deleted only if it names
  // the dated copy beside the Finder folder, never another directory.
  if (!isPreservedCopy(result.preserved, identity.domainDisplay)) {
    throw new Error(
      `Refusing to delete ${result.preserved}, which is not a preserved Finder folder`,
    )
  }
  rmSync(result.preserved, { recursive: true, force: true })
}

/**
 * Whether `path` is the copy macOS keeps of a removed Finder folder: directly
 * in CloudStorage, named like the folder with a date in parentheses after it.
 */
export function isPreservedCopy(
  path: string,
  domainDisplay: string,
  root = join(homedir(), 'Library', 'CloudStorage'),
): boolean {
  return (
    dirname(path) === root && basename(path).includes(`-${domainDisplay.replace(/\s+/g, '')} (`)
  )
}

function appPids(identity: DesktopIdentity): number[] {
  const out = Bun.spawnSync(['pgrep', '-f', `${identity.appPath}/Contents/MacOS/`])
  return out.stdout.toString().split('\n').filter(Boolean).map(Number)
}

/** Quits the app the way a person does, which also stops the daemon it started. */
async function quitApp(identity: DesktopIdentity): Promise<void> {
  if (appPids(identity).length === 0) return
  Bun.spawnSync(['osascript', '-e', `quit app "${identity.appName}"`], { timeout: 30_000 })
  await waitFor(`${identity.appName} to quit`, () => appPids(identity).length === 0, {
    timeoutMs: 30_000,
    intervalMs: 250,
  })
}

const leaseFile = (identity: DesktopIdentity) => join(SIM_HOME, `desktop-${identity.context}.lease`)

/**
 * The session holding the build, if that session still exists. A scenario
 * run's session outlives a runner that was killed, until `prune` removes it,
 * so a `run-` session whose runner has exited holds nothing.
 */
function leaseHolder(identity: DesktopIdentity): string | null {
  const file = leaseFile(identity)
  if (!existsSync(file)) return null
  const name = readFileSync(file, 'utf8').trim()
  let session: Session | null
  try {
    session = Session.load(name)
  } catch {
    return null
  }
  if (!session) return null
  if (name.startsWith('run-') && !isAlive(session.state.createdBy)) return null
  return name
}

async function takeLease(identity: DesktopIdentity, session: string): Promise<void> {
  let told = false
  await waitFor(
    `the ${identity.appName} build to be free`,
    () =>
      withFileLock(join(SIM_HOME, `desktop-${identity.context}.lock`), async () => {
        const holder = leaseHolder(identity)
        if (holder && holder !== session) {
          if (!told)
            console.error(`Waiting for session ${holder} to finish with ${identity.appName}`)
          told = true
          return false
        }
        mkdirSync(SIM_HOME, { recursive: true })
        writeFileSync(leaseFile(identity), session)
        return true
      }),
    { timeoutMs: 30 * 60_000, intervalMs: 5000 },
  )
}

/**
 * Quits the build and removes its Finder folder when no session holds it,
 * which `prune --all` runs, and returns the app's name when it did either.
 */
export async function release(): Promise<string[]> {
  if (process.platform !== 'darwin') return []
  const identity = desktopIdentity()
  if (!existsSync(identity.appPath) || leaseHolder(identity)) return []
  const running = appPids(identity).length > 0
  await quitApp(identity)
  const registered = runAgent(identity, ['list']).domains?.includes(identity.domainId) ?? false
  removeDomain(identity)
  rmSync(leaseFile(identity), { force: true })
  return running || registered ? [identity.appName] : []
}

export type FinderState = {
  size: number
  /** `notDownloaded`, `downloaded` or `current`, as Finder's cloud badge shows it. */
  downloadStatus: string | null
  /** Whether Finder leaves the extension off the name it shows. */
  extensionHidden: boolean
  /** The Uniform Type Identifier Finder opens the file as, such as `public.png`. */
  contentType: string | null
  cloudOnly: boolean
}

// `NSURLContentTypeKey` answers with a Swift UTType, which crashes the
// JavaScript bridge (osascript exits 133), so the type comes from
// `NSURLTypeIdentifierKey`, the same identifier as a string.
const FINDER_STATE_SCRIPT = String.raw`
ObjC.import('Foundation')
function run(argv) {
  const url = $.NSURL.fileURLWithPath(argv[0])
  const read = (key) => {
    const value = Ref()
    url.getResourceValueForKeyError(value, key, null)
    const v = value[0]
    return v === undefined || v.isNil() ? null : ObjC.unwrap(v.description)
  }
  const status = read($.NSURLUbiquitousItemDownloadingStatusKey)
  return JSON.stringify({
    size: Number(read($.NSURLFileSizeKey) || 0),
    downloadStatus: status
      ? status.replace('NSURLUbiquitousItemDownloadingStatus', '').replace(/^./, (c) => c.toLowerCase())
      : null,
    extensionHidden: read($.NSURLHasHiddenExtensionKey) === '1',
    contentType: read($.NSURLTypeIdentifierKey),
  })
}`

/** SF_DATALESS in `stat -f %f`: the file is a placeholder whose bytes are still in the cloud. */
const SF_DATALESS = 0x40000000

export class DesktopDevice extends CliDevice {
  override readonly kind = 'desktop' as const
  readonly identity = desktopIdentity()

  /** What the app is launched with. The app hands it on to the daemon it starts. */
  private launchEnv(): Record<string, string> {
    return {
      SIA_DATA_DIR: this.paths.dataDir,
      SIA_TEST_MODE: '1',
      SIA_MOCK_NETWORK_URL: this.session.networkUrl(),
      SIA_SIM_DEVICE: this.name,
      SIA_DAEMON_SCRIPT: CLI_ENTRY,
      SIA_DAEMON_RUNTIME: process.execPath,
      NO_COLOR: '1',
      ...(this.session.state.fastTimers ? { EXPO_PUBLIC_SIM_FAST_TIMERS: '1' } : {}),
    }
  }

  override async start(): Promise<void> {
    const unavailable = desktopUnavailable(this.identity)
    if (unavailable) throw new Error(unavailable)
    await takeLease(this.identity, this.session.name)
    mkdirSync(this.paths.dataDir, { recursive: true })
    if (!this.signedOut && !existsSync(this.paths.secretsPath)) await this.mustCli('connect')
    await quitApp(this.identity)
    // The system keeps what it listed and downloaded for a Finder folder until
    // the folder is removed, so a device's first start begins from none of it.
    // A restart keeps the folder, as quitting and reopening the app does.
    if (!this.session.state.devices[this.name]?.prepared) {
      removeDomain(this.identity)
      await this.session.update((s) => {
        s.devices[this.name].prepared = true
      })
    }
    // Chromium's debugging port, which drives the windows. The app allows one
    // running copy, and a second launch hands its environment to nothing, so
    // the port goes on this launch, the first since the quit above. A copy the
    // daemon reopens for a Finder share inherits the same environment, and so
    // the same port.
    const debugPort = freePort()
    await this.session.update((s) => {
      s.devices[this.name].debugPort = debugPort
    })
    const env = { ...this.launchEnv(), SIA_SIM_DEBUG_PORT: String(debugPort) }
    const flags = Object.entries(env).flatMap(([k, v]) => ['--env', `${k}=${v}`])
    const opened = Bun.spawnSync(['open', ...flags, this.identity.appPath])
    if (opened.exitCode !== 0) {
      throw new Error(`open ${this.identity.appName} failed: ${opened.stderr.toString().trim()}`)
    }
    await waitFor(`${this.name} daemon to answer`, () => this.ping(), { timeoutMs: 60_000 })
    const mount = await waitFor(
      `${this.name}'s Finder folder`,
      () => findMount(this.identity.domainDisplay),
      { timeoutMs: 60_000, intervalMs: 500 },
    )
    // macOS syncs an extension's folder only once someone has switched the
    // extension on in System Settings. Until then fileproviderd answers "Sync is
    // not enabled" and listing or opening anything in the folder fails with
    // ETIMEDOUT, which a scenario would otherwise report as the app failing.
    await waitFor(`${this.name}'s Finder folder to open`, () => readdir(mount).then(() => true), {
      timeoutMs: 20_000,
      intervalMs: 1000,
    }).catch((e: unknown) => {
      if (!String(e).includes('ETIMEDOUT')) throw e
      throw new Error(
        `macOS has not switched on ${this.identity.appName}'s Finder folder. Turn on ${this.identity.appName} under File Providers in System Settings, General, Login Items & Extensions, then start the device again.`,
      )
    })
  }

  /**
   * Every checkout launches the same installed app, so quitting or killing it
   * while another session holds the lease would stop that session's device.
   */
  private holdsLease(): boolean {
    return leaseHolder(this.identity) === this.session.name
  }

  override async stop(): Promise<void> {
    if (this.holdsLease()) await quitApp(this.identity)
    await super.stop()
  }

  override async kill(): Promise<void> {
    if (this.holdsLease()) {
      for (const pid of appPids(this.identity)) {
        try {
          process.kill(pid, 'SIGKILL')
        } catch {}
      }
    }
    await super.kill()
  }

  override async isRunning(): Promise<boolean> {
    return appPids(this.identity).length > 0 && (await super.isRunning())
  }

  /**
   * Quits the app, removes its Finder folder and frees the build for the next
   * session, when this session holds the build.
   */
  async dispose(): Promise<void> {
    if (this.holdsLease()) {
      try {
        await this.stop().catch(() => {})
        removeDomain(this.identity)
      } finally {
        rmSync(leaseFile(this.identity), { force: true })
      }
    }
    await this.session.update((s) => {
      delete s.devices[this.name].prepared
    })
  }

  /**
   * Whether the device was added to start with no account. Its daemon then
   * comes up disconnected and the app opens its window on sign-in, which a
   * scenario drives through `ui()`. Once it has signed in that way a restart
   * finds the account like any other device's.
   */
  get signedOut(): boolean {
    return this.session.state.devices[this.name]?.signedOut === true
  }

  /**
   * Kills the app's own processes and leaves its daemon running, as a crash
   * of the app would. Quitting the app the way a person does stops the daemon
   * too.
   */
  async killApp(): Promise<void> {
    for (const pid of appPids(this.identity)) process.kill(pid, 'SIGKILL')
    await waitFor(`${this.identity.appName} to exit`, () => appPids(this.identity).length === 0, {
      timeoutMs: 15_000,
      intervalMs: 250,
    })
  }

  /**
   * Opens the app's main window the way launching the app again does, and
   * waits until it is on screen. An app started with an account shows no
   * window until asked, only its menu bar icon.
   */
  async openWindow(): Promise<void> {
    const opened = Bun.spawnSync(['open', this.identity.appPath])
    if (opened.exitCode !== 0) {
      throw new Error(`open ${this.identity.appName} failed: ${opened.stderr.toString().trim()}`)
    }
    const ui = this.ui()
    await waitFor(`${this.name}'s window to open`, () => ui.isShowing('main'), {
      timeoutMs: 15_000,
      intervalMs: 250,
    })
  }

  /**
   * Opens the status popover by clicking the menu bar icon, and waits until it
   * is on screen. The popover hides when it loses focus, so it is opened right
   * before the step that reads it.
   */
  async openPopover(): Promise<void> {
    const ui = this.ui()
    if (await ui.isShowing('popover')) return
    ui.clickTray()
    await waitFor(`${this.name}'s popover to open`, () => ui.isShowing('popover'), {
      timeoutMs: 15_000,
      intervalMs: 250,
    })
  }

  /** The app's windows, menus and dialogs. */
  ui(): DesktopUi {
    const port = this.session.state.devices[this.name]?.debugPort
    if (!port) throw new Error(`${this.name} has not started, so its windows are not open`)
    return new DesktopUi(port, this.identity.appName)
  }

  /**
   * What macOS reports for a file in the Finder folder: its size, whether its
   * bytes are downloaded, whether Finder hides its extension, and the content
   * type Finder opens it as. Read through Foundation's URL resource values, the
   * same ones Finder reads, by `osascript`.
   */
  finderState(path: string): FinderState {
    const out = Bun.spawnSync(
      ['osascript', '-l', 'JavaScript', '-e', FINDER_STATE_SCRIPT, this.finderPath(path)],
      { timeout: 30_000 },
    )
    if (out.exitCode !== 0)
      throw new Error(`Reading ${path} in Finder failed: ${out.stderr.toString().trim()}`)
    return {
      ...(JSON.parse(out.stdout.toString()) as Omit<FinderState, 'cloudOnly'>),
      cloudOnly: this.isCloudOnly(path),
    }
  }

  /**
   * Downloads a cloud-only file in the Finder folder by reading it through
   * Finder, which is what opening it does. macOS serves File Provider item
   * calls such as a download request only to the app that contains the
   * extension, so the app's domain helper cannot make one.
   */
  async download(path: string): Promise<void> {
    await this.finderRead(path)
  }

  /**
   * An image of each open window's page, and the Finder folder's top level as
   * text: each entry with what Finder shows for it. A screenshot of Finder
   * itself would carry the person's sidebar and other folders, so there is none.
   */
  async captureMore(dir: string): Promise<void> {
    const ui = this.ui()
    for (const window of await ui.windowNames().catch(() => [])) {
      await ui.capture(window, join(dir, `${window}.png`)).catch(() => {})
    }
    const entries = this.finderList().map((name) => {
      try {
        return { name, ...this.finderState(name) }
      } catch (e) {
        return { name, error: e instanceof Error ? e.message : String(e) }
      }
    })
    writeFileSync(join(dir, 'finder.json'), `${JSON.stringify(entries, null, 2)}\n`)
  }

  /** Brings the app's windows forward and opens its Finder folder in a Finder window. */
  async show(): Promise<string> {
    Bun.spawnSync(['open', this.identity.appPath])
    Bun.spawnSync(['open', this.finderPath()])
    return `${this.identity.appName} is in front, and its Finder folder is open in Finder.`
  }

  /** The Finder folder, or a path inside it. */
  finderPath(path = ''): string {
    const mount = findMount(this.identity.domainDisplay)
    if (!mount) throw new Error(`${this.name} has no Finder folder`)
    return join(mount, path)
  }

  /**
   * Sends what Finder's Share Link action sends for these files, on the socket
   * the extension uses: their item ids, which are the files' stack ids. The
   * menu item itself belongs to Finder, which nothing here can click.
   */
  async finderShare(names: string[]): Promise<void> {
    const itemIds: string[] = []
    for (const name of names) {
      const [row] = await this.sql<{ stackId: string }>(
        `SELECT stackId FROM files WHERE name = ? AND kind = 'file' AND current = 1
           AND trashedAt IS NULL AND deletedAt IS NULL`,
        name,
      )
      if (!row) throw new Error(`No file named ${name} on ${this.name}`)
      itemIds.push(row.stackId)
    }
    const socket = this.identity.providerSocket
    if (!socket) throw new Error(`The ${this.identity.context} build context names no extension`)
    await sendIpcCommand(socket, 'share', { args: [itemIds] })
  }

  /**
   * Names in a Finder folder directory, without the dot files the system adds,
   * composed (NFC). The File Provider folder lists every name decomposed (NFD)
   * whatever form the library holds, so a raw listing never equals the names a
   * device stores.
   */
  finderList(dir = ''): string[] {
    return readdirSync(this.finderPath(dir))
      .filter((n) => !n.startsWith('.'))
      .map((n) => n.normalize('NFC'))
  }

  /** Reads a file through Finder, which downloads it first when it is still in the cloud. */
  finderRead(path: string, timeoutMs = 120_000): Promise<Uint8Array> {
    return readFile(this.finderPath(path), { signal: AbortSignal.timeout(timeoutMs) })
  }

  async finderWrite(path: string, bytes: Uint8Array): Promise<void> {
    const target = this.finderPath(path)
    mkdirSync(dirname(target), { recursive: true })
    await writeFile(target, bytes)
  }

  async finderRename(from: string, to: string): Promise<void> {
    await rename(this.finderPath(from), this.finderPath(to))
  }

  async finderRemove(path: string): Promise<void> {
    await rm(this.finderPath(path), { recursive: true })
  }

  /** Whether a file in the Finder folder is a placeholder whose bytes have not been downloaded. */
  isCloudOnly(path: string): boolean {
    const out = Bun.spawnSync(['stat', '-f', '%f', this.finderPath(path)], { timeout: 30_000 })
    if (out.exitCode !== 0) {
      throw new Error(`stat ${path} in the Finder folder failed: ${out.stderr.toString().trim()}`)
    }
    return (Number(out.stdout.toString().trim()) & SF_DATALESS) !== 0
  }

  /** The extension's log for the last `minutes`, from the system log it writes to. */
  extensionLog(minutes = 5): string {
    const out = Bun.spawnSync(
      [
        'log',
        'show',
        '--last',
        `${minutes}m`,
        '--style',
        'compact',
        '--predicate',
        'subsystem == "sia.storage.fileprovider"',
      ],
      { timeout: 60_000 },
    )
    return out.stdout.toString()
  }

  /** The Electron app's own log, beside the daemon's in its data directory. */
  appLog(lines = 50): string {
    const file = join(this.paths.dataDir, 'desktop.log')
    if (!existsSync(file)) return ''
    return readFileSync(file, 'utf8')
      .split('\n')
      .slice(-lines - 1)
      .join('\n')
  }

  async preserve(dir: string): Promise<void> {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'extension.log'), this.extensionLog(15))
    writeFileSync(join(dir, 'desktop.log'), this.appLog(500))
  }
}
