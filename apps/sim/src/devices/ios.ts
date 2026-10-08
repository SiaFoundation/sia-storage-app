/**
 * A phone that is the mobile app on an iOS simulator leased from the pool. Its
 * container is a folder on this Mac, so its database and documents are read
 * and written directly, and the SQLite locks it holds can be inspected.
 */
import { readDatabase } from '../sqlite'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type HeldLock, heldLocks } from '../ios/locks'
import * as pool from '../ios/pool'
import * as simctl from '../ios/simctl'
import { freePort, type ProcessSample, psSample } from '../process'
import { REPO_ROOT } from '../session'
import { IDLE_SESSION_SECONDS } from '../ui/driver'
import { waitFor, waitForApp } from '../wait'
import { PhoneDevice } from './phone'

const BUNDLE_ID = 'sia.storage.dev'
const EXECUTABLE = 'SiaStorageDev'
const APP_GROUP = 'group.sia.storage.dev'
const APP_PATH = join(
  REPO_ROOT,
  'apps/mobile/.build-cache/ios-sim/DerivedData/Build/Products/Debug-iphonesimulator/SiaStorageDev.app',
)
/** Where macOS writes a crash report for a simulator's app, as for any Mac process. */
const CRASH_REPORTS = join(homedir(), 'Library/Logs/DiagnosticReports')

export class IosDevice extends PhoneDevice {
  readonly kind = 'ios' as const
  /** Set once `removePhotos` has shut the simulator down. */
  private shutDown = false

  private get udid(): string {
    const udid = this.target
    if (!udid) throw new Error(`${this.name} has no simulator yet`)
    return udid
  }

  protected buildArtifact(): string {
    return APP_PATH
  }

  protected buildCommand(): string {
    return 'bun run mobile:dev:ios:simulator -- --no-run'
  }

  private get uiPorts(): { wda: number; mjpeg: number } {
    const ports = this.session.state.devices[this.name]?.uiPorts
    if (!ports) throw new Error(`${this.name} has no simulator yet`)
    return ports
  }

  protected uiCapabilities(): Record<string, unknown> {
    return {
      platformName: 'iOS',
      'appium:automationName': 'XCUITest',
      'appium:udid': this.udid,
      'appium:bundleId': BUNDLE_ID,
      'appium:autoLaunch': false,
      'appium:noReset': true,
      // Without it the driver opens the Simulator app's window, which sim has no use for.
      'appium:isHeadless': true,
      'appium:newCommandTimeout': IDLE_SESSION_SECONDS,
      // The first session on a simulator builds WebDriverAgent before it
      // starts. One attempt, since each retry waits the full launch timeout
      // again and the driver's default of two would outlast the session start
      // timeout in ui/driver.ts.
      'appium:wdaLaunchTimeout': 600_000,
      'appium:wdaStartupRetries': 1,
      'appium:wdaLocalPort': this.uiPorts.wda,
      'appium:mjpegServerPort': this.uiPorts.mjpeg,
    }
  }

  protected async prepare(): Promise<void> {
    if (this.target && this.prepared) {
      await pool.bootHeld(this.target)
      return
    }
    const udid = this.target ?? (await pool.lease(this.session.name))
    const wda = freePort()
    let mjpeg = freePort()
    while (mjpeg === wda) mjpeg = freePort()
    await this.record({ target: udid, uiPorts: { wda, mjpeg } })
    await pool.bootHeld(udid)
    await simctl.uninstall(udid, BUNDLE_ID)
    await simctl.resetKeychain(udid)
    await simctl.install(udid, APP_PATH)
    // A reinstall can give the app group a new container.
    this.container = undefined
    // The dev client opens its menu over the app on a fresh install's first
    // launch, and shows a floating button on every screen after, both of which
    // cover what a UI step needs to see.
    await simctl.setDefault(udid, BUNDLE_ID, 'EXDevMenuIsOnboardingFinished', true)
    await simctl.setDefault(udid, BUNDLE_ID, 'EXDevMenuShowsAtLaunch', false)
    await simctl.setDefault(udid, BUNDLE_ID, 'EXDevMenuShowFloatingActionButton', false)
    await this.record({ prepared: true })
  }

  protected async writeDocument(name: string, contents: string): Promise<void> {
    const documents = join(await simctl.appDataDir(this.udid, BUNDLE_ID), 'Documents')
    mkdirSync(documents, { recursive: true })
    writeFileSync(join(documents, name), contents)
  }

  private container: Promise<string> | undefined

  /**
   * The App Group container, where the app keeps its database and files. Its
   * path lasts as long as the simulator, and `simctl get_app_container` can
   * take a minute on a loaded machine, so it is asked once.
   */
  private containerDir(): Promise<string> {
    this.container ??= simctl.appGroupDir(this.udid, BUNDLE_ID, APP_GROUP).catch((e) => {
      this.container = undefined
      throw e
    })
    return this.container
  }

  protected async stageFiles(localPaths: string[], batch: string): Promise<string[]> {
    const inbox = join(await this.containerDir(), 'sim-inbox', batch)
    return localPaths.map((localPath, i) => {
      mkdirSync(join(inbox, String(i)), { recursive: true })
      const target = join(inbox, String(i), basename(localPath))
      copyFileSync(localPath, target)
      return target
    })
  }

  /** The simulator shares this Mac's network, loopback included. */
  protected fromDevice(url: string): string {
    return url
  }

  protected async launch(metro: string): Promise<void> {
    await simctl.launch(this.udid, BUNDLE_ID, ['--initialUrl', metro])
  }

  /**
   * Writes the simulator's log from the app's process, and every line from
   * another process that names the app, such as the launch and termination
   * SpringBoard and RunningBoard record. It also copies each crash report
   * for the app written since `since`. Crash reports from every simulator
   * share one folder, and a report names the simulator in its process path.
   */
  protected async saveSystemLog(
    dir: string,
    prefix: string,
    since: Date,
  ): Promise<string | undefined> {
    mkdirSync(dir, { recursive: true })
    const log = await simctl.logSince(
      this.udid,
      since,
      // Spotlight logs every installed app's id when the app list changes.
      `(process == "${EXECUTABLE}" OR eventMessage CONTAINS "${BUNDLE_ID}") AND process != "searchd"`,
    )
    writeFileSync(join(dir, `${prefix}-system.log`), log.split('\n').slice(-5000).join('\n'))
    let crash: string | undefined
    const reports = existsSync(CRASH_REPORTS) ? readdirSync(CRASH_REPORTS) : []
    for (const name of reports) {
      if (!name.startsWith(`${EXECUTABLE}-`)) continue
      const path = join(CRASH_REPORTS, name)
      if (statSync(path).mtimeMs < since.getTime() - 2000) continue
      const text = readFileSync(path, 'utf8')
      // The report's JSON escapes the slashes in the simulator's path.
      if (!text.includes(this.udid)) continue
      copyFileSync(path, join(dir, `${prefix}-${name}`))
      crash ??= crashReason(text)
    }
    return crash
  }

  protected async query<T>(sql: string, params: unknown[]): Promise<T[]> {
    return readDatabase<T>(join(await this.containerDir(), 'app.db'), sql, params)
  }

  /**
   * `simctl terminate` can hang on an app that launched but never connected,
   * and a launch retry stops the app first, so a terminate that has not
   * returned in 15 seconds is followed by a kill.
   */
  async stop(): Promise<void> {
    if (!this.target) return
    try {
      await simctl.terminate(this.target, BUNDLE_ID, 15_000)
    } catch (e) {
      if (!(await this.isRunning())) return
      await this.kill().catch(() => {
        throw e
      })
    }
  }

  async kill(): Promise<void> {
    const pid = await simctl.appPid(this.udid, EXECUTABLE)
    if (!pid) throw new Error(`${this.name} is not running, so there is nothing to kill`)
    process.kill(pid, 'SIGKILL')
    await waitFor(`${this.name} to exit`, async () => !(await this.isRunning()), {
      timeoutMs: 10_000,
    })
  }

  async isRunning(): Promise<boolean> {
    return this.target ? (await simctl.appPid(this.target, EXECUTABLE)) !== null : false
  }

  /** Sends the app to the background, where iOS suspends it a few seconds later. */
  async background(): Promise<void> {
    await simctl.openSettings(this.udid)
  }

  protected async resume(): Promise<void> {
    await simctl.launch(this.udid, BUNDLE_ID, [])
  }

  /** Waits until iOS has suspended the app, however long its background work runs. */
  async waitUntilSuspended(since: Date, timeoutMs = 60_000): Promise<void> {
    const udid = this.udid
    const pid = await simctl.appPid(udid, EXECUTABLE)
    if (!pid) throw new Error(`${this.name} is not running`)
    await waitForApp(
      `iOS to suspend ${this.name}`,
      () => simctl.wasSuspendedSince(udid, pid, since),
      {
        timeoutMs,
        intervalMs: 1000,
      },
    )
  }

  /**
   * SQLite locks the app's process holds on its database right now. The probe
   * reports one holder per region, so this relies on the app being the only
   * process with the database open: sim's own queries open, read and close it
   * without awaiting, so none is open while the probe runs.
   */
  async locks(): Promise<HeldLock[]> {
    const pid = await simctl.appPid(this.udid, EXECUTABLE)
    const all = await heldLocks(join(await this.containerDir(), 'app.db'))
    return pid ? all.filter((l) => l.pid === pid) : all
  }

  /**
   * Grants full photo library access through the system prompt, as a person
   * does. `simctl privacy grant photos` records a grant that Photos still
   * reports as undetermined to the app on this runtime, so the prompt is the
   * one way that works.
   */
  async grantPhotoAccess(): Promise<void> {
    if (await this.call<boolean>('sim.photoAccess')) return
    // The UI session starts first: the app's request waits on the prompt, and
    // a first session can take longer to start than that call may wait.
    await this.ui().source()
    const asked = this.call('sim.requestPhotoAccess')
    await this.ui().tap({ text: 'Allow Full Access' }, 30_000)
    await asked
  }

  protected async putPhotos(paths: string[]): Promise<void> {
    await simctl.addMedia(this.udid, paths)
  }

  /**
   * Empties the whole library, since `simctl addmedia` has no inverse that
   * takes out one photo, and its files can be deleted only while the simulator
   * is shut down.
   */
  protected async removePhotos(target: string): Promise<void> {
    await simctl.stopTestRunner(target)
    await simctl.shutdown(target)
    this.shutDown = true
    simctl.clearPhotoLibrary(target)
  }

  protected async discard(target: string): Promise<void> {
    await pool.discard(target)
  }

  async screenshot(path: string): Promise<void> {
    await simctl.screenshot(this.udid, path)
  }

  /** The simulator's app container is a folder on this Mac, so its URIs are host paths. */
  async moveAppFile(fromUri: string, toUri: string): Promise<void> {
    renameSync(fileURLToPath(fromUri), fileURLToPath(toUri))
  }

  async sampleProcess(): Promise<ProcessSample | null> {
    const pid = await simctl.appPid(this.udid, EXECUTABLE)
    return pid === null ? null : psSample(pid)
  }

  /** Opens the Simulator app on this phone's simulator, which keeps running without it. */
  async show(): Promise<string> {
    const opened = Bun.spawnSync([
      'open',
      '-a',
      'Simulator',
      '--args',
      '-CurrentDeviceUDID',
      this.udid,
    ])
    if (opened.exitCode !== 0)
      throw new Error(`open -a Simulator failed: ${opened.stderr.toString()}`)
    return `${this.name} is in the Simulator app. Quitting the Simulator app leaves it running.`
  }

  protected async copyDatabase(dir: string): Promise<void> {
    const container = await this.containerDir()
    for (const file of ['app.db', 'app.db-wal', 'app.db-shm']) {
      if (existsSync(join(container, file))) copyFileSync(join(container, file), join(dir, file))
    }
  }

  /** Back to the pool, still booted unless emptying its photo library shut it down, so the next phone skips the boot. */
  protected release(target: string): void {
    if (this.shutDown) pool.releaseOff(target)
    else pool.release(target)
  }
}

/**
 * Why a crash report's process ended: the exception type and signal, the
 * termination reason, an uncaught exception's message when there is one, and
 * the top symbolicated frame of the thread that crashed.
 * A `.ips` report is a line of JSON header followed by a JSON body. Returns
 * undefined for a report it cannot read.
 */
export function crashReason(ips: string): string | undefined {
  let body: {
    exception?: { type?: string; signal?: string }
    termination?: { indicator?: string }
    exceptionReason?: { composed_message?: string }
    faultingThread?: number
    threads?: Array<{ frames?: Array<{ symbol?: string }> }>
  }
  try {
    body = JSON.parse(ips.slice(ips.indexOf('\n') + 1))
  } catch {
    return undefined
  }
  const { exception, termination, exceptionReason, faultingThread, threads } = body
  const top =
    faultingThread === undefined
      ? undefined
      : threads?.[faultingThread]?.frames?.find((f) => f.symbol)?.symbol
  const parts = [
    exception?.type &&
      (exception.signal ? `${exception.type} (${exception.signal})` : exception.type),
    termination?.indicator,
    exceptionReason?.composed_message,
    top && `in ${top}`,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : undefined
}
