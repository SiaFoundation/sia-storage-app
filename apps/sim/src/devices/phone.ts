/**
 * What every phone device shares, whatever the platform. The mobile app runs
 * the checkout's debug build with JavaScript from the shared Metro server. A
 * `sim.json` in its documents folder points it at the session's network and
 * names it (apps/mobile/src/testMode), and it answers calls through the
 * network's relay, since nothing can connect into a simulator or emulator.
 *
 * A platform supplies how to get a clean device with the app installed, how
 * to write a file into the app's sandbox, how to launch, stop and kill it, and
 * how to read its database.
 */
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { createNetworkControl } from '@siastorage/mock-network/control'
import { ensureMetro } from '../metro'
import type { DeviceRecord, PhoneKind, Session } from '../session'
import { logActions, UiDriver } from '../ui/driver'
import { Cancelled, waitFor, waitForApp } from '../wait'
import { LIBRARY_QUERY, toLibrary } from './library'
import type { Device, LibraryEntry } from './types'

type Status = { hasOnboarded: boolean; isInitializing: boolean; isConnected: boolean }

/**
 * A phone that never got as far as the app connecting: its build is missing,
 * its simulator or emulator did not boot, Metro could not build the bundle,
 * or the app did not open its control socket. It keeps the message and stack
 * of the error it wraps. The runner stops starting phones of `kind` after two
 * scenarios in a row end on one.
 */
export class PhoneStartFailed extends Error {
  constructor(
    readonly kind: PhoneKind,
    cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause), { cause })
    if (cause instanceof Error && cause.stack) this.stack = cause.stack
  }
}

export abstract class PhoneDevice implements Device {
  abstract readonly kind: PhoneKind

  constructor(
    readonly name: string,
    protected readonly session: Session,
  ) {}

  /** The simulator udid or emulator serial this device runs on, once it has one. */
  protected get target(): string | undefined {
    return this.session.state.devices[this.name]?.target
  }

  /** Whether the leased device has been wiped and the app installed. */
  protected get prepared(): boolean {
    return this.session.state.devices[this.name]?.prepared === true
  }

  protected async record(change: Partial<DeviceRecord>): Promise<void> {
    await this.session.update((s) => {
      Object.assign(s.devices[this.name], change)
    })
  }

  /** The installable build, which must exist before a phone can start. */
  protected abstract buildArtifact(): string
  protected abstract buildCommand(): string
  /**
   * A running device with the app installed. On the device's first start in a
   * session it is a pooled device whose app has none of its own data left,
   * installed again or, on Android when the build is unchanged, cleared with
   * `pm clear`. The photo library stays as the session
   * that held the device before left it. A later start, after a stop or a
   * kill, keeps the app and its data, as relaunching a phone does.
   */
  protected abstract prepare(): Promise<void>
  /** Writes `contents` to `name` in the app's documents folder. */
  protected abstract writeDocument(name: string, contents: string): Promise<void>
  /**
   * Copies local files into a folder named `batch` in the app's sandbox and
   * returns the paths the app sees, in order. A folder per import, and one
   * per file inside it, so no two files with the same name overwrite each
   * other's staged copy, within an import or across two.
   */
  protected abstract stageFiles(localPaths: string[], batch: string): Promise<string[]>
  /** Starts the app with its JavaScript from `metro`. */
  protected abstract launch(metro: string): Promise<void>
  /**
   * Saves the system's log about the app since `since` into `dir`, as files
   * named from `prefix`, and returns the first line saying why the app
   * crashed, if the log or a crash report has one.
   */
  protected abstract saveSystemLog(
    dir: string,
    prefix: string,
    since: Date,
  ): Promise<string | undefined>
  /** `url`, a server on the host's loopback, as the app on the device reaches it. */
  protected abstract fromDevice(url: string): string
  protected abstract query<T>(sql: string, params: unknown[]): Promise<T[]>
  /**
   * Moves a file inside the app's own storage, both given as the `file://`
   * URIs the app reports, to stand up what a crash or an older version left
   * on disk.
   */
  abstract moveAppFile(fromUri: string, toUri: string): Promise<void>
  abstract stop(): Promise<void>
  /** Kills the app's process, and resolves once it has exited. Throws if the app is not running. */
  abstract kill(): Promise<void>
  abstract isRunning(): Promise<boolean>
  abstract background(): Promise<void>
  /** Brings the app back to the front, without waiting for it to answer. */
  protected abstract resume(): Promise<void>
  abstract screenshot(path: string): Promise<void>
  /** Gives the app full access to the photo library, without leaving a prompt on screen. */
  abstract grantPhotoAccess(): Promise<void>
  /** Adds image files to the device's photo library, as a camera or a saved download would. */
  abstract addPhotos(paths: string[]): Promise<void>
  /** Copies the app's database, with its WAL files, into `dir`. */
  protected abstract copyDatabase(dir: string): Promise<void>
  protected abstract release(target: string): void

  async preserve(dir: string): Promise<void> {
    mkdirSync(dir, { recursive: true })
    await this.screenshot(join(dir, 'failure.png')).catch(() => {})
    await this.copyDatabase(dir).catch(() => {})
    writeFileSync(join(dir, 'app.log'), await this.logs(500).catch(() => ''))
  }

  /** Stops the app and hands the simulator or emulator back to its pool. */
  async dispose(): Promise<void> {
    this.disposed = true
    const target = this.target
    if (!target) return
    await this.driver?.close()
    this.driver = null
    await this.stop().catch(() => {})
    this.release(target)
    await this.session.update((s) => {
      delete s.devices[this.name].target
      delete s.devices[this.name].prepared
      delete s.devices[this.name].uiPorts
    })
  }

  /** Appium capabilities that attach to this phone's running app without relaunching it. */
  protected abstract uiCapabilities(): Record<string, unknown>

  private driver: UiDriver | null = null
  private disposed = false

  /**
   * Taps and waits for elements on the app's screen through its accessibility
   * tree. Refused once the phone is back in its pool, where a new UI session
   * would attach to whatever scenario leases it next. A caller that closed the
   * last driver, as a scenario does before restarting the app, gets a new one.
   */
  ui(): UiDriver {
    if (this.disposed) throw new Error(`${this.name} has been handed back to its pool`)
    if (!this.driver || this.driver.isClosed) {
      const dir = this.session.deviceDir(this.name)
      this.driver = logActions(
        new UiDriver(this.kind, this.uiCapabilities(), {
          onOpen: () => this.foreground(),
          keyboardShown: async () => {
            const k = await this.call<{ visible: boolean; height: number | null }>('sim.keyboard')
            return k.visible && (k.height ?? 0) > 0
          },
        }),
        (line) => {
          mkdirSync(dir, { recursive: true })
          appendFileSync(join(dir, 'ui.log'), line)
        },
      )
    }
    return this.driver
  }

  protected control() {
    return createNetworkControl(this.session.networkUrl())
  }

  readonly startCrashes: string[] = []

  async start(opts: { relaunchAfterCrash?: boolean } = {}): Promise<void> {
    if (!existsSync(this.buildArtifact())) {
      throw new PhoneStartFailed(
        this.kind,
        `No ${this.kind} build at ${this.buildArtifact()}. Build it with: ${this.buildCommand()}`,
      )
    }
    await this.session.update((s) => {
      s.startingPhones = [...(s.startingPhones ?? []), process.pid]
    })
    try {
      await this.startApp(opts.relaunchAfterCrash ?? false)
    } finally {
      await this.session
        .update((s) => {
          const at = s.startingPhones?.indexOf(process.pid) ?? -1
          if (at >= 0) s.startingPhones?.splice(at, 1)
        })
        .catch(() => {})
    }
  }

  private async startApp(relaunchAfterCrash: boolean): Promise<void> {
    let metro: string
    try {
      ;[, metro] = await Promise.all([this.prepare(), ensureMetro(this.kind)])
      await this.writeDocument(
        'sim.json',
        JSON.stringify({
          url: this.fromDevice(this.session.networkUrl()),
          device: this.name,
          fastTimers: this.session.state.fastTimers,
        }),
      )
    } catch (e) {
      throw e instanceof Cancelled ? e : new PhoneStartFailed(this.kind, e)
    }
    for (const tag of ['', 'relaunch-']) {
      try {
        await this.launchAndFinishStarting(metro, tag)
        return
      } catch (e) {
        const crash = crashOf(e)
        if (!crash || !relaunchAfterCrash || tag) throw e
        this.startCrashes.push(crash)
      }
    }
  }

  /**
   * Launches the app and waits until it has signed in and connected. Its
   * screenshots and system logs are named from `tag`, so a relaunch keeps the
   * first launch's.
   */
  private async launchAndFinishStarting(metro: string, tag: string): Promise<void> {
    try {
      await this.launchUntilConnected(metro, tag)
    } catch (e) {
      throw e instanceof Cancelled ? e : new PhoneStartFailed(this.kind, e)
    }
    // A call made while the app reconnects its control socket fails, so both
    // are polled rather than called once. Sign-in is called again only once
    // an earlier attempt has had half a minute to finish.
    let signInAt = 0
    const connectedAt = new Date()
    await waitForApp(
      `${this.name} to finish starting`,
      async () => {
        const s = await this.call<Status>('sim.status')
        if (!s.hasOnboarded) {
          // The app runs initApp at launch and sim.signIn runs it again. Two
          // runs at once migrate the database together, and the app crashes
          // inside expo-sqlite.
          if (s.isInitializing) return false
          if (Date.now() - signInAt > 30_000) {
            signInAt = Date.now()
            await this.call('sim.signIn', this.fromDevice(this.session.networkUrl()))
          }
          return false
        }
        return !s.isInitializing && s.isConnected
      },
      { timeoutMs: 180_000, intervalMs: 500 },
    ).catch(async (e: unknown) => {
      // An app that connected and then crashed or stalled during startup has
      // the same missing reason as one that never connected.
      const dir = this.session.deviceDir(this.name)
      await this.screenshot(`${dir}/${tag}start.png`).catch(() => {})
      const crash = await this.saveSystemLog(dir, `${tag}start`, connectedAt).catch(() => undefined)
      if (!crash || !(e instanceof Error)) throw e
      e.message = `${e.message}. The app crashed: ${crash}`
      throw withCrash(e, crash)
    })
  }

  /**
   * Brings the app back to the front and waits until it can answer calls. A
   * resumed app reports its lifecycle over its control socket, and a call
   * made before that arrives fails as if the app were still suspended. A
   * `simctl launch` can return without bringing the app forward, and then the
   * app never reports anything, so the resume is sent again every 10 seconds.
   */
  async foreground(): Promise<void> {
    let resumedAt = 0
    await waitForApp(
      `${this.name} to come back to the foreground`,
      async () => {
        if (Date.now() - resumedAt > 10_000) {
          resumedAt = Date.now()
          await this.resume()
        }
        return (await this.control().connectedDevices())[this.name]?.lifecycle === 'foreground'
      },
      { timeoutMs: 30_000, intervalMs: 250 },
    )
  }

  /**
   * Launches the app and waits for it to open a new control socket. A killed
   * app's old socket can still be listed for a moment, so being connected is
   * not enough, and the count is read once the old app has stopped, so its
   * last reconnect cannot pass for the new one. A dev launcher gives up on a
   * slow bundle load and shows its server list instead of the app, most often
   * on a loaded machine, so a launch that fails or has not connected in 120
   * seconds is retried, three times in all. Each failed attempt leaves a
   * screenshot and the system's log beside it, since an app that crashes
   * before its JavaScript runs writes nothing to its own log.
   */
  private async launchUntilConnected(metro: string, tag: string): Promise<void> {
    const control = this.control()
    const dir = this.session.deviceDir(this.name)
    let crash: string | undefined
    for (let attempt = 1; ; attempt++) {
      await this.stop()
      const before = (await control.connectedDevices())[this.name]?.sockets ?? 0
      const launchedAt = new Date()
      try {
        await this.launch(metro)
        await waitFor(
          `${this.name} to connect its control socket`,
          async () => ((await control.connectedDevices())[this.name]?.sockets ?? 0) > before,
          { timeoutMs: 120_000, intervalMs: 500 },
        )
        return
      } catch (e) {
        const shot = `${dir}/${tag}launch-${attempt}.png`
        await this.screenshot(shot).catch(() => {})
        const found = await this.saveSystemLog(dir, `${tag}launch-${attempt}`, launchedAt).catch(
          () => undefined,
        )
        crash ??= found
        if (attempt === 3) {
          const message = e instanceof Error ? e.message : String(e)
          // The crash goes before the paths, which a one-line summary cuts first.
          const error = new Error(
            `${message}${crash ? `. The app crashed: ${crash}` : ''} (screenshot ${shot}, system logs beside it)`,
          )
          throw crash ? withCrash(error, crash) : error
        }
      }
    }
  }

  call<T = unknown>(method: string, ...args: unknown[]): Promise<T> {
    return this.control().callDevice<T>(this.name, method, args)
  }

  sql<T = Record<string, unknown>>(query: string, ...params: unknown[]): Promise<T[]> {
    return this.query<T>(query, params)
  }

  /**
   * Stages files through the function the app's file picker calls, which
   * starts the import scanner at once, and returns without waiting for the
   * copy, so a scenario can act while it runs. Resolves to the import's id.
   */
  async importFiles(paths: string[], opts: { dir?: string } = {}): Promise<string> {
    const batch = crypto.randomUUID().slice(0, 8)
    const staged = await this.stageFiles(paths, batch)
    const directoryId = opts.dir
      ? (await this.call<{ id: string }>('directories.getOrCreateAtPath', opts.dir)).id
      : null
    const { importId } = await this.call<{ importId: string | null }>(
      'sim.importFiles',
      staged,
      directoryId,
    )
    if (!importId) throw new Error(`${this.name} staged none of ${paths.length} files`)
    return importId
  }

  /**
   * Waits until no row of the import is pending or copying, and returns how
   * many rows ended in each state.
   */
  async waitForImport(importId: string, timeoutMs = 120_000): Promise<Record<string, number>> {
    await waitForApp(
      `${this.name} to finish import ${importId}`,
      async () => {
        const [row] = await this.sql<{ n: number }>(
          `SELECT count(*) AS n FROM import_files WHERE importId = ?1 AND state IN ('pending', 'active')`,
          importId,
        )
        return row.n === 0
      },
      { timeoutMs, intervalMs: 500 },
    )
    const rows = await this.sql<{ state: string; n: number }>(
      'SELECT state, count(*) AS n FROM import_files WHERE importId = ?1 GROUP BY state',
      importId,
    )
    return Object.fromEntries(rows.map((r) => [r.state, r.n]))
  }

  /** Imports one file through the picker path and waits for its file row. */
  async addFile(path: string, opts: { dir?: string } = {}): Promise<{ id: string; name: string }> {
    const importId = await this.importFiles([path], opts)
    // The import finalizes asynchronously. The file row reuses the import
    // row's id, which exists once the scanner has copied the bytes.
    const [row] = await waitForApp(
      `${this.name} to import ${basename(path)}`,
      async () => {
        const rows = await this.sql<{ id: string; name: string }>(
          'SELECT f.id, f.name FROM import_files i JOIN files f ON f.id = i.id WHERE i.importId = ?1',
          importId,
        )
        return rows.length > 0 ? rows : undefined
      },
      { timeoutMs: 60_000, intervalMs: 300 },
    )
    return { id: row.id, name: row.name }
  }

  async library(): Promise<LibraryEntry[]> {
    return toLibrary(await this.sql(LIBRARY_QUERY))
  }

  async logs(lines = 50): Promise<string> {
    const rows = await this.sql<{
      timestamp: string
      level: string
      scope: string
      message: string
      data: string | null
    }>('SELECT timestamp, level, scope, message, data FROM logs ORDER BY id DESC LIMIT ?1', lines)
    return rows
      .reverse()
      .map(
        (r) =>
          `${r.timestamp} ${r.level.toUpperCase()} [${r.scope}] ${r.message}${r.data ? ` ${r.data}` : ''}`,
      )
      .join('\n')
  }
}

/** Marks a failed start with the first line saying why the app crashed. */
function withCrash(e: Error, crash: string): Error {
  return Object.assign(e, { crash })
}

/** The crash a failed start was marked with, looking through PhoneStartFailed's cause. */
function crashOf(e: unknown): string | undefined {
  for (let at: unknown = e; at instanceof Error; at = at.cause) {
    const crash = (at as { crash?: unknown }).crash
    if (typeof crash === 'string') return crash
  }
  return undefined
}
