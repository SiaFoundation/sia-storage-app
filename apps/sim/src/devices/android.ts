/**
 * A phone that is the mobile app on an Android emulator leased from the pool.
 * The app's sandbox is inside the emulator, reached with `run-as`, which a
 * debuggable build allows.
 */
import { Database } from 'bun:sqlite'
import { readDatabase } from '../sqlite'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { adb, q } from '../android/adb'
import * as emulators from '../android/emulators'
import { REPO_ROOT } from '../session'
import { IDLE_SESSION_SECONDS } from '../ui/driver'
import type { ProcessSample } from '../process'
import { waitFor } from '../wait'
import { PhoneDevice } from './phone'

const PACKAGE = 'sia.storage.dev'
const APK_PATH = join(REPO_ROOT, 'apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk')
/** The app's files dir, where expo's documents folder and its SQLite folder live. */
const FILES = `/data/data/${PACKAGE}/files`
const DB_DIR = `${FILES}/SQLite`
/** Where `adb push` can write that the app's user can then read from. */
const DROP = '/data/local/tmp/sia-sim'
/** Shared storage the photo library scans. */
const PHOTOS = '/sdcard/Pictures'

export class AndroidDevice extends PhoneDevice {
  readonly kind = 'android' as const

  private get serial(): string {
    const serial = this.target
    if (!serial) throw new Error(`${this.name} has no emulator yet`)
    return serial
  }

  private get adb() {
    return adb(this.serial)
  }

  protected buildArtifact(): string {
    return APK_PATH
  }

  protected buildCommand(): string {
    return 'bun run mobile:dev:android:emulator -- --no-run'
  }

  protected uiCapabilities(): Record<string, unknown> {
    return {
      platformName: 'Android',
      'appium:automationName': 'UiAutomator2',
      'appium:udid': this.serial,
      'appium:appPackage': PACKAGE,
      'appium:autoLaunch': false,
      'appium:noReset': true,
      'appium:newCommandTimeout': IDLE_SESSION_SECONDS,
      // Reads the tree without waiting for the UI to go idle, which a screen
      // with a spinner or a list re-rendering during uploads never does.
      'appium:settings[waitForIdleTimeout]': 0,
      // Opening a session resets hidden API settings over adb, and on a busy
      // emulator that adb call fails and the session with it.
      'appium:ignoreHiddenApiPolicyError': true,
    }
  }

  protected async prepare(): Promise<void> {
    // The emulator this phone ran on may have died since, and another,
    // possibly someone else's, started on its port.
    if (this.target && !emulators.isOurs(this.target)) {
      emulators.forget(this.target)
      await this.record({ target: undefined, prepared: false })
    }
    if (this.target && this.prepared) return
    await this.record({ target: this.target ?? (await emulators.lease(this.session.name)) })
    // `pm clear` leaves the app as a fresh install does, and skips pushing
    // and installing the APK again.
    const apk = statSync(APK_PATH)
    const build = `${apk.size}-${Math.floor(apk.mtimeMs)}`
    const installed = await this.adb.shell(`cat ${DROP}/installed-build`).catch(() => '')
    const present = await this.adb.shell(`pm path ${PACKAGE}`).catch(() => '')
    if (installed.trim() === build && present.includes('package:')) {
      await this.adb.shell(`pm clear ${PACKAGE}`)
    } else {
      await this.adb.uninstall(PACKAGE)
      await this.adb.install(APK_PATH)
      await this.adb.shell(
        `mkdir -p ${DROP} && chmod 777 ${DROP} && echo ${build} > ${DROP}/installed-build`,
      )
    }
    await this.quietDevMenu()
    await this.record({ prepared: true })
  }

  /**
   * The dev client opens its menu over the app on a fresh install's first
   * launch, and shows a floating button on every screen after, both of which
   * cover what a UI step needs to see. It reads both from these preferences.
   */
  private async quietDevMenu(): Promise<void> {
    const dir = mkdtempSync(join(tmpdir(), 'sim-prefs-'))
    try {
      const name = 'expo.modules.devmenu.sharedpreferences.xml'
      writeFileSync(
        join(dir, name),
        "<?xml version='1.0' encoding='utf-8' standalone='yes' ?><map>" +
          '<boolean name="isOnboardingFinished" value="true" />' +
          '<boolean name="showsAtLaunch" value="false" />' +
          '<boolean name="showFab" value="false" /></map>',
      )
      const remote = await this.drop(join(dir, name), `${this.name}-${name}`)
      const prefs = `/data/data/${PACKAGE}/shared_prefs`
      await this.adb.runAs(PACKAGE, `mkdir -p ${prefs} && cp ${q(remote)} ${q(`${prefs}/${name}`)}`)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  /**
   * Grants the photo library permissions the app checks, which the system
   * would otherwise ask for. expo-media-library counts access as granted only
   * with media location too, since the app declares it, and from Android 13
   * with images and video as separate permissions.
   */
  async grantPhotoAccess(): Promise<void> {
    const sdk = Number((await this.adb.shell('getprop ro.build.version.sdk')).trim())
    const permissions = [
      ...(sdk >= 33 ? ['READ_MEDIA_IMAGES', 'READ_MEDIA_VIDEO'] : ['READ_EXTERNAL_STORAGE']),
      ...(sdk >= 29 ? ['ACCESS_MEDIA_LOCATION'] : []),
    ]
    for (const permission of permissions) {
      await this.adb.shell(`pm grant ${PACKAGE} android.permission.${permission}`)
    }
  }

  /** Adds files to the emulator's photo library: shared storage, then a media scan so MediaStore lists them. */
  async addPhotos(paths: string[]): Promise<void> {
    for (const path of paths) {
      const remote = `${PHOTOS}/${basename(path)}`
      await this.adb.push(path, remote)
      await this.adb.shell(
        `am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d ${q(`file://${remote}`)}`,
      )
    }
  }

  /** Pushes a local file to a place the app's user can copy it from, and returns that path. */
  private async drop(localPath: string, name = basename(localPath)): Promise<string> {
    await this.adb.shell(`mkdir -p ${DROP} && chmod 777 ${DROP}`)
    const remote = `${DROP}/${name}`
    await this.adb.push(localPath, remote)
    await this.adb.shell(`chmod 644 ${q(remote)}`)
    return remote
  }

  protected async writeDocument(name: string, contents: string): Promise<void> {
    const dir = mkdtempSync(join(tmpdir(), 'sim-doc-'))
    try {
      const local = join(dir, name)
      writeFileSync(local, contents)
      const remote = await this.drop(local, `${this.name}-${name}`)
      await this.adb.runAs(PACKAGE, `mkdir -p ${FILES} && cp ${q(remote)} ${q(`${FILES}/${name}`)}`)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  /**
   * Gathers the files into one local folder so the whole import takes one
   * push and one `run-as`, since every adb call is a round trip to the
   * emulator and a scenario can stage hundreds of files.
   */
  protected async stageFiles(localPaths: string[], batch: string): Promise<string[]> {
    const local = mkdtempSync(join(tmpdir(), 'sim-stage-'))
    try {
      const folder = join(local, batch)
      mkdirSync(folder)
      localPaths.forEach((path, i) => {
        mkdirSync(join(folder, String(i)))
        copyFileSync(path, join(folder, String(i), basename(path)))
      })
      await this.adb.shell(
        `mkdir -p ${DROP} && chmod 777 ${DROP} && rm -rf ${q(`${DROP}/${batch}`)}`,
      )
      await this.adb.push(folder, DROP)
      await this.adb.shell(`chmod -R 755 ${q(`${DROP}/${batch}`)}`)
    } finally {
      rmSync(local, { recursive: true, force: true })
    }
    const dir = `${FILES}/sim-inbox/${batch}`
    await this.adb.runAs(
      PACKAGE,
      `mkdir -p ${FILES}/sim-inbox && cp -R ${q(`${DROP}/${batch}`)} ${q(dir)}`,
    )
    await this.adb.shell(`rm -rf ${q(`${DROP}/${batch}`)}`)
    return localPaths.map((path, i) => `${dir}/${i}/${basename(path)}`)
  }

  protected async launch(metro: string): Promise<void> {
    const url = `sia://expo-development-client/?url=${encodeURIComponent(this.fromDevice(metro))}`
    await this.adb.shell(`am start -a android.intent.action.VIEW -d '${url}' ${PACKAGE}`)
  }

  /**
   * Writes logcat since `since` twice: the lines about the app, and the last
   * 5000 lines of everything, which shows what the system was doing. The
   * emulator's clock follows the host's, and the window opens two seconds
   * early for the difference.
   */
  protected async saveSystemLog(
    dir: string,
    prefix: string,
    since: Date,
  ): Promise<string | undefined> {
    const from = ((since.getTime() - 2000) / 1000).toFixed(3)
    const dump = await this.adb.logcat(['-d', '-v', 'threadtime', '-T', from])
    const { lines, crash } = appLogcat(dump, PACKAGE)
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, `${prefix}-logcat.txt`),
      lines.length > 0 ? `${lines.join('\n')}\n` : `No lines about ${PACKAGE}\n`,
    )
    writeFileSync(join(dir, `${prefix}-logcat-all.txt`), dump.split('\n').slice(-5000).join('\n'))
    return crash
  }

  /**
   * The emulator reaches the host's loopback at 10.0.2.2. `adb reverse` would
   * let the app use 127.0.0.1 as other devices do, but a reverse mapping lives
   * on adb's connection to the emulator, which drops and reconnects under load,
   * and the reconnect leaves the app cut off from the network and Metro.
   */
  protected fromDevice(url: string): string {
    return url.replace('://127.0.0.1:', '://10.0.2.2:')
  }

  /**
   * Copies a snapshot of the database into `dir` that matches one moment of
   * the app's. The app writes to the WAL, which is copied after the database
   * file and so carries every change the database copy lacks. Two things
   * leave an older database that still passes an integrity check. A
   * checkpoint, the one write to the database file itself, can empty the WAL
   * between the two copies, so the database file's time and size are read
   * before and after, and a copy they differ across is taken again. A WAL
   * pulled short over adb drops the frames past the cut, so each pulled file
   * must match the size the device reported. The -shm index is left behind,
   * and SQLite rebuilds it from the WAL copy on open. Should every attempt
   * fail, the app writes the copy itself.
   */
  private async snapshotDatabase(dir: string): Promise<void> {
    const snap = `${FILES}/simsnap`
    for (let attempt = 1; attempt <= 6; attempt++) {
      const listed = await this.adb
        .runAs(
          PACKAGE,
          `rm -rf ${snap} && mkdir -p ${snap} && cd ${DB_DIR} && ` +
            `before=$(stat -c '%y %s' app.db) && cp app.db ${snap}/ && ` +
            `{ [ ! -f app.db-wal ] || cp app.db-wal ${snap}/; } && ` +
            `[ "$before" = "$(stat -c '%y %s' app.db)" ] && cd ${snap} && stat -c '%n %s' *`,
        )
        .catch(() => '')
      const copied = new Map(
        listed
          .split('\n')
          .map((line) => line.trim().split(' '))
          .filter(([name, size]) => name && size)
          .map(([name, size]) => [name, Number(size)] as const),
      )
      if (!copied.has('app.db')) continue
      for (const file of ['app.db', 'app.db-wal', 'app.db-shm']) {
        rmSync(join(dir, file), { force: true })
      }
      let pulled = true
      for (const [file, size] of copied) {
        const bytes = await this.adb.readAs(PACKAGE, `${snap}/${file}`).catch(() => null)
        if (!bytes || bytes.length !== size) {
          pulled = false
          break
        }
        writeFileSync(join(dir, file), bytes)
      }
      if (!pulled) continue
      const db = new Database(join(dir, 'app.db'))
      try {
        const check = db.query('PRAGMA quick_check').get() as { quick_check: string }
        if (check.quick_check === 'ok') return
      } catch {
        // A copy taken mid-write can fail to open at all. Take it again.
      } finally {
        db.close()
      }
    }
    if (await this.copyFromApp(dir)) return
    throw new Error(`${this.name}: no consistent copy of the database in 6 attempts`)
  }

  /**
   * Has the app write the copy with VACUUM INTO, which reads one snapshot of
   * every committed write. It runs on the app's writer and holds its writes
   * back meanwhile, so it is the fallback rather than every read. Only an
   * app in the foreground answers.
   */
  private async copyFromApp(dir: string): Promise<boolean> {
    if ((await this.control().connectedDevices())[this.name]?.lifecycle !== 'foreground') {
      return false
    }
    const path = `${FILES}/simsnap-app.db`
    try {
      await this.adb.runAs(PACKAGE, `rm -f ${path}`)
      await this.call('sim.copyDatabase', path)
      const bytes = await this.adb.readAs(PACKAGE, path)
      for (const file of ['app.db', 'app.db-wal', 'app.db-shm']) {
        rmSync(join(dir, file), { force: true })
      }
      writeFileSync(join(dir, 'app.db'), bytes)
      return true
    } catch {
      return false
    }
  }

  protected async query<T>(sql: string, params: unknown[]): Promise<T[]> {
    const dir = mkdtempSync(join(tmpdir(), 'sim-db-'))
    try {
      await this.snapshotDatabase(dir)
      return readDatabase<T>(join(dir, 'app.db'), sql, params)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  async stop(): Promise<void> {
    if (this.target) await this.adb.shell(`am force-stop ${PACKAGE}`)
  }

  /** Kills the process without a chance to clean up, as the low-memory killer does. */
  async kill(): Promise<void> {
    const pid = (await this.adb.shell(`pidof ${PACKAGE}`).catch(() => '')).trim()
    if (!pid) throw new Error(`${this.name} is not running, so there is nothing to kill`)
    await this.adb.runAs(PACKAGE, `kill -9 ${pid}`)
    await waitFor(`${this.name} to exit`, async () => !(await this.isRunning()), {
      timeoutMs: 10_000,
    })
  }

  async isRunning(): Promise<boolean> {
    return this.target
      ? (await this.adb.shell(`pidof ${PACKAGE}`).catch(() => '')).trim() !== ''
      : false
  }

  async background(): Promise<void> {
    await this.adb.shell('input keyevent KEYCODE_HOME')
  }

  /**
   * Sends the intent a launcher icon sends, with the launcher's new-task and
   * reset-task flags, which brings the running app's task to the front rather
   * than starting another activity.
   */
  protected async resume(): Promise<void> {
    await this.adb.shell(
      `am start -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -f 0x10200000 -n ${PACKAGE}/.MainActivity`,
    )
  }

  async screenshot(path: string): Promise<void> {
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, await this.adb.screencap())
  }

  /** The app's files are readable only as the app's own user, through run-as. */
  async moveAppFile(fromUri: string, toUri: string): Promise<void> {
    const path = (uri: string) => decodeURIComponent(new URL(uri).pathname)
    await this.adb.runAs(PACKAGE, `mv ${q(path(fromUri))} ${q(path(toUri))}`)
  }

  async sampleProcess(): Promise<ProcessSample | null> {
    // pidof exits nonzero when nothing matches, which adb reports as a failure.
    const pid = (await this.adb.shell(`pidof ${PACKAGE}`).catch(() => '')).trim().split(/\s+/)[0]
    if (!pid) return null
    const out = await this.adb.shell(`top -b -n 1 -p ${pid} -o %CPU,RES`)
    return parseTop(out)
  }

  /** An emulator gets its window when it boots, or never, so this can only say how to get one. */
  async show(): Promise<string> {
    if (emulators.hasWindow(this.serial)) return `${this.name} already has a window.`
    return `${this.name}'s emulator booted without a window, and one cannot be added to it. Set SIM_EMULATOR_WINDOW=1, run \`bun sim prune --all\`, then start the phone again.`
  }

  protected async copyDatabase(dir: string): Promise<void> {
    await this.snapshotDatabase(dir)
  }

  /** Back to the pool, still running, so the next phone skips the boot. */
  protected release(target: string): void {
    emulators.release(target)
  }
}

/** A `logcat -v threadtime` line: date, time, pid, tid, level, tag and message. */
const LOGCAT_LINE = /^\S+ \S+\s+(\d+)\s+\d+ [A-Z] (.*?)\s*: ?(.*)$/

/**
 * The lines of a `logcat -v threadtime` dump about app `pkg`, and the line
 * saying why it crashed, if it did. A line is about the app when one of its
 * processes logged it, when it names the package, or when its tag is
 * AndroidRuntime, which prints a Java crash. The app's pids come from
 * ActivityManager's `Start proc` and `Process ... has died` lines and from a
 * crash's own report. The crash is the exception line under the app's
 * `FATAL EXCEPTION`, or failing that a native crash's `Fatal signal` line with
 * the abort message the crash dump logs after it.
 */
export function appLogcat(dump: string, pkg: string): { lines: string[]; crash?: string } {
  const p = pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pidPatterns = [
    new RegExp(`Start proc (\\d+):${p}/`),
    new RegExp(`Process: ${p}, PID: (\\d+)`),
    new RegExp(`Process ${p} \\(pid (\\d+)\\)`),
    new RegExp(`pid (\\d+) \\(${p}\\)`),
  ]
  const rows = dump.split('\n').flatMap((line) => {
    const m = LOGCAT_LINE.exec(line)
    return m ? [{ line, pid: m[1], tag: m[2], message: m[3] }] : []
  })
  const pids = new Set<string>()
  for (const { message } of rows) {
    for (const pattern of pidPatterns) {
      const pid = pattern.exec(message)?.[1]
      if (pid) pids.add(pid)
    }
  }
  const lines = rows
    .filter((r) => pids.has(r.pid) || r.tag === 'AndroidRuntime' || r.message.includes(pkg))
    .map((r) => r.line)

  let javaCrash: string | undefined
  let nativeCrash: string | undefined
  rows.forEach((row, i) => {
    if (!javaCrash && row.tag === 'AndroidRuntime' && row.message.startsWith('FATAL EXCEPTION')) {
      const block = rows
        .slice(i + 1)
        .filter((r) => r.pid === row.pid && r.tag === 'AndroidRuntime')
        .slice(0, 2)
      if (block[0]?.message.startsWith(`Process: ${pkg},`) && block[1]) {
        javaCrash = block[1].message.trim()
      }
    }
    if (!nativeCrash && /^Fatal signal /.test(row.message) && row.message.includes(`(${pkg})`)) {
      const abort = rows
        .slice(i + 1)
        .find((r) => r.message.startsWith('Abort message:'))
        ?.message.trim()
      nativeCrash = abort ? `${row.message.trim()}, ${abort}` : row.message.trim()
    }
  })
  return { lines, crash: javaCrash ?? nativeCrash }
}

/**
 * The CPU and resident memory from `top -o %CPU,RES` for one process, whose
 * last line is the process and whose RES is in KiB unless it carries a K, M or
 * G suffix.
 */
export function parseTop(out: string): ProcessSample | null {
  const line = out.trim().split('\n').at(-1)?.trim() ?? ''
  const [cpuText, resText] = line.split(/\s+/)
  const cpu = Number(cpuText)
  const m = /^([\d.]+)([KMG]?)$/i.exec(resText ?? '')
  if (!Number.isFinite(cpu) || !m) return null
  const unit = m[2].toUpperCase()
  const kib = Number(m[1]) * (unit === 'G' ? 1024 * 1024 : unit === 'M' ? 1024 : 1)
  return { cpu, rssMb: kib / 1024 }
}
