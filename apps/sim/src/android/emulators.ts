/**
 * The pool of Android emulators for this checkout. Every emulator runs one AVD
 * read-only, which is what lets several run from it at once, and nothing a
 * test does changes the AVD itself.
 */
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import type { Subprocess } from 'bun'
import { join } from 'node:path'
import { withPhoneRoom } from '../capacity'
import { withFileLock } from '../lock'
import { DevicePool } from '../pool'
import { defaultSessionName, SIM_HOME } from '../session'
import { waitFor } from '../wait'
import { ADB, AVDMANAGER, adb, EMULATOR, listEmulators, SYSTEM_IMAGES, tool } from './adb'

const dir = join(SIM_HOME, `android-pool-${defaultSessionName()}`)
const pool = new DevicePool(dir)

/**
 * Emulators boot an AVD sim creates for itself rather than one made by hand,
 * whose data partition holds whatever it has accumulated. The app holds photo
 * imports while less than 2 GB is free, so an AVD a developer uses daily can
 * leave every import scenario waiting. `SIM_ANDROID_AVD` names another AVD.
 */
const AVD = 'sia-sim'
const AVD_HOME = process.env.ANDROID_AVD_HOME ?? join(homedir(), '.android', 'avd')
// On Linux avdmanager and the emulator can put AVDs outside ~/.android/avd, so both are
// given this folder. Bun.spawn's default env ignores later writes to process.env.
const AVD_ENV = { ...process.env, ANDROID_AVD_HOME: AVD_HOME }
/**
 * Written into the AVD's config.ini. The medium phone profile's 2 GB of RAM
 * leaves a Google Play image under enough memory pressure that the system
 * kills background processes, adb's connection to the emulator drops, and
 * Appium's instrumentation dies. With a hardware keyboard Android keeps the
 * on-screen one hidden, and a tap that would close it reaches the app instead.
 */
const AVD_CONFIG: Record<string, string> = {
  'disk.dataPartition.size': '8G',
  'hw.ramSize': '4G',
  'hw.keyboard': 'no',
}

async function avdName(): Promise<string> {
  if (process.env.SIM_ANDROID_AVD) return process.env.SIM_ANDROID_AVD
  await withFileLock(join(SIM_HOME, 'android-avd.lock'), async () => {
    if (!existsSync(join(AVD_HOME, `${AVD}.ini`))) {
      mkdirSync(AVD_HOME, { recursive: true })
      await tool(
        [AVDMANAGER, 'create', 'avd', '-n', AVD, '-k', systemImage(), '-d', 'medium_phone'],
        { env: AVD_ENV },
      )
    }
    // Set on every boot, so an AVD whose creation stopped before this line,
    // or one made before a value here changed, still gets them.
    const config = join(AVD_HOME, `${AVD}.avd`, 'config.ini')
    const text = readFileSync(config, 'utf8')
    let next = text
    for (const [key, value] of Object.entries(AVD_CONFIG)) {
      const line = `${key}=${value}`
      const pattern = new RegExp(`^${key.replace(/\./g, '\\.')}=.*$`, 'm')
      next = pattern.test(next) ? next.replace(pattern, line) : `${next.trimEnd()}\n${line}\n`
    }
    if (next !== text) writeFileSync(config, next)
  })
  return AVD
}

/** The newest installed system image for this machine's architecture. */
function systemImage(): string {
  const abi = process.arch === 'arm64' ? 'arm64-v8a' : 'x86_64'
  const levels = existsSync(SYSTEM_IMAGES)
    ? readdirSync(SYSTEM_IMAGES)
        .filter((d) => /^android-\d+$/.test(d))
        .sort((a, b) => Number(b.slice(8)) - Number(a.slice(8)))
    : []
  for (const level of levels) {
    for (const tag of ['google_apis', 'google_apis_playstore', 'default']) {
      if (existsSync(join(SYSTEM_IMAGES, level, tag, abi))) {
        return `system-images;${level};${tag};${abi}`
      }
    }
  }
  throw new Error(
    `No Android system image for ${abi}. Install one: sdkmanager "system-images;android-36;google_apis;${abi}"`,
  )
}

/** Emulators this process started that have not yet been seen to boot. */
const booting = new Map<string, Subprocess>()

/**
 * Starts a headless emulator on the next free console port and returns its
 * serial without waiting for the boot, which runs outside the pool's lock so
 * that phones starting at once boot their emulators at the same time.
 */
function spawnEmulator(adopt: (serial: string) => void): Promise<string> {
  // adb lists a new emulator only once its console port is open, so the port
  // is chosen, and held until adb lists it, under a lock every checkout on
  // this machine takes. Two checkouts starting at once would otherwise both
  // pick the first free port, and one emulator would exit.
  return withFileLock(join(SIM_HOME, 'android-ports.lock'), async () => {
    // Every emulator adb lists, whatever its state, and whoever started it:
    // one still booting is offline, and holds its port.
    const used = new Set((await listEmulators()).map((e) => e.serial))
    let port = 5560
    while (used.has(`emulator-${port}`) || pool.members().includes(`emulator-${port}`)) port += 2
    const serial = await startEmulator(port, adopt)
    await waitFor(
      `adb to list ${serial}`,
      async () => (await listEmulators()).some((e) => e.serial === serial),
      { timeoutMs: 60_000, intervalMs: 500 },
    ).catch(() => {})
    return serial
  })
}

async function startEmulator(port: number, adopt: (serial: string) => void): Promise<string> {
  const serial = `emulator-${port}`
  mkdirSync(dir, { recursive: true })
  const log = openSync(join(dir, `${serial}.log`), 'w')
  const child = Bun.spawn(
    [
      EMULATOR,
      '-avd',
      await avdName(),
      '-port',
      String(port),
      '-read-only',
      // A window costs memory and GPU, and nothing a scenario checks needs one.
      ...(process.env.SIM_EMULATOR_WINDOW === '1' ? [] : ['-no-window']),
      '-no-audio',
      '-no-boot-anim',
      '-no-snapshot-save',
    ],
    { stdio: ['ignore', log, log], detached: true, env: AVD_ENV },
  )
  child.unref()
  closeSync(log)
  adopt(serial)
  // The launcher replaces itself with qemu, so this is the emulator's pid.
  writeFileSync(pidFile(serial), String(child.pid))
  booting.set(serial, child)
  return serial
}

/** Waits for an emulator this process started to boot, then settles it. */
async function waitForBoot(serial: string, child: Subprocess): Promise<void> {
  // An emulator that exits, such as one that lost its port to another, never
  // boots, and another process's emulator may answer on its serial.
  const polling = new AbortController()
  const exited = child.exited.then((code) => {
    polling.abort()
    throw new Error(`${serial} exited with code ${code} before booting, see ${dir}/${serial}.log`)
  })
  exited.catch(() => {})
  try {
    await Promise.race([
      exited,
      waitFor(
        `${serial} to boot`,
        async () => (await adb(serial).shell('getprop sys.boot_completed')).trim() === '1',
        { timeoutMs: 5 * 60_000, intervalMs: 2000, signal: polling.signal },
      ),
    ])
  } catch (e) {
    polling.abort()
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {}
    throw e
  }
  await settle(serial)
}

/**
 * Waits for Android to finish booting and turns animations off. Runs on every
 * lease, since an emulator whose boot a killed run was waiting on joins the
 * pool without either. Both steps are quick once done.
 */
async function settle(serial: string): Promise<void> {
  await waitFor(
    `${serial} to boot`,
    async () => (await adb(serial).shell('getprop sys.boot_completed')).trim() === '1',
    { timeoutMs: 5 * 60_000, intervalMs: 2000 },
  )
  // Animations make every screen transition slower and screen reads flakier.
  for (const setting of [
    'window_animation_scale',
    'transition_animation_scale',
    'animator_duration_scale',
  ]) {
    await adb(serial).shell(`settings put global ${setting} 0`)
  }
  // AVD_CONFIG turns the hardware keyboard off, but an AVD named by
  // SIM_ANDROID_AVD keeps its own config.ini, so the on-screen keyboard is
  // told to show even beside a hardware one.
  await adb(serial).shell('settings put secure show_ime_with_hard_keyboard 1')
  // On a slow CI runner System UI can stop responding, and the dialog Android
  // shows for it covers the app, so every screen read finds the dialog. With
  // error dialogs hidden Android kills the unresponsive process instead, and
  // System UI, which Android keeps running, restarts.
  await adb(serial).shell('settings put global hide_error_dialogs 1')
}

const portOf = (serial: string) => Number(serial.slice('emulator-'.length))
const pidFile = (serial: string) => join(dir, `${serial}.pid`)

/** The emulator process listening on console `port`, from the process list. */
function emulatorOnPort(port: number): number | null {
  const ps = Bun.spawnSync(['ps', '-Ao', 'pid=,args='])
  for (const line of ps.stdout.toString().split('\n')) {
    const [, pid, args] = /^\s*(\d+)\s+(.*)$/.exec(line) ?? []
    if (args?.includes('qemu-system') && / -port (\d+)/.exec(args)?.[1] === String(port)) {
      return Number(pid)
    }
  }
  return null
}

/**
 * Whether the emulator on `serial` is the one this pool booted. A pooled
 * emulator that died leaves its member file, and another checkout or Android
 * Studio can later start an emulator on the same port, which a check of the
 * serial alone would take for the pool's and wipe.
 */
export function isOurs(serial: string): boolean {
  if (!existsSync(pidFile(serial))) return false
  return emulatorOnPort(portOf(serial)) === Number(readFileSync(pidFile(serial), 'utf8'))
}

/** Whether the emulator on `serial` was booted with a window. */
export function hasWindow(serial: string): boolean {
  const pid = emulatorOnPort(portOf(serial))
  if (pid === null) return false
  const args = Bun.spawnSync(['ps', '-o', 'args=', '-p', String(pid)]).stdout.toString()
  return !args.includes('-no-window')
}

/**
 * Leases a running emulator, starting one when every pooled emulator is taken
 * and one more fits the memory budget in capacity.ts.
 */
export async function lease(session: string): Promise<string> {
  await discardHung()
  const serial = await withPhoneRoom('android', async (room) => {
    const running = (await listEmulators()).filter((e) => e.state === 'device')
    // A member that is no longer ours is forgotten, not stopped: whatever runs
    // on its serial now belongs to someone else.
    return pool.lease(
      session,
      running.map((e) => e.serial).filter(isOurs),
      room ? spawnEmulator : null,
      isOurs,
    )
  })
  const child = booting.get(serial)
  booting.delete(serial)
  try {
    if (child) await waitForBoot(serial, child)
    else await settle(serial)
  } catch (e) {
    // The phone records the serial only once this returns, so an emulator
    // left leased here would stay leased and running with nothing to free it.
    discard(serial)
    throw e
  }
  return serial
}

/**
 * Kills this pool's unleased emulators that adb calls offline and that have
 * run for longer than any boot takes. A hung emulator is never leased, since
 * only an online one is, but it keeps its share of the memory budget, so every
 * later lease waits for room it never frees until the run's start deadline
 * passes. A leased one is left alone, since adb drops a busy emulator's
 * connection for a moment under memory pressure.
 */
async function discardHung(): Promise<void> {
  for (const { serial, state } of await listEmulators()) {
    if (state !== 'offline' || booting.has(serial) || !isOurs(serial)) continue
    if (pool.isLeased(serial)) continue
    const pid = emulatorOnPort(portOf(serial))
    if (pid !== null && runningSeconds(pid) > 5 * 60) discard(serial)
  }
}

/** How long a process has run, from ps's elapsed time, `[[dd-]hh:]mm:ss`. */
function runningSeconds(pid: number): number {
  const etime = Bun.spawnSync(['ps', '-o', 'etime=', '-p', String(pid)])
    .stdout.toString()
    .trim()
  const [days, rest] = etime.includes('-') ? etime.split('-') : ['0', etime]
  const parts = rest.split(':').map(Number)
  while (parts.length < 3) parts.unshift(0)
  const [h, m, sec] = parts
  return Number(days) * 86_400 + h * 3600 + m * 60 + sec
}

/** Kills an emulator this pool started and drops it from the pool. */
export function discard(serial: string): void {
  if (isOurs(serial)) {
    try {
      process.kill(Number(readFileSync(pidFile(serial), 'utf8')), 'SIGKILL')
    } catch {}
  }
  pool.forget(serial)
}

/** Drops an emulator that is no longer this pool's from it, without stopping it. */
export function forget(serial: string): void {
  pool.forget(serial)
}

export function release(serial: string): void {
  pool.release(serial)
}

/**
 * Stops the pooled emulators no session has held for `idleMs`. One that is
 * still running afterwards stays in the pool, so the next call tries it again
 * instead of leaving it running where nothing would ever stop it.
 */
export async function stopIdle(idleMs: number): Promise<string[]> {
  // Checked before the lock too, since every sim command calls this and a
  // lease holds the lock while it waits for adb to list a new emulator.
  if (pool.idle(idleMs).length === 0) return []
  return pool.locked(async () => {
    const idle = pool.idle(idleMs)
    const ours = idle.filter(isOurs)
    for (const serial of idle) if (!ours.includes(serial)) pool.forget(serial)
    const stopped = await Promise.all(ours.map(stop))
    const drained = ours.filter((_, i) => stopped[i])
    for (const serial of drained) pool.forget(serial)
    return drained
  })
}

/** Stops every pooled emulator no session holds. */
export function drain(): Promise<string[]> {
  return stopIdle(0)
}

export function busy(idleMs: number): boolean {
  return pool.busy(idleMs)
}

/**
 * `adb emu kill` can answer OK and leave the emulator running, so the kill is
 * judged by the serial leaving `adb devices`, and sent again if it stays.
 */
async function stop(serial: string): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    await tool([ADB, '-s', serial, 'emu', 'kill']).catch(() => {})
    const exited = await waitFor(
      `${serial} to exit`,
      async () => !(await listEmulators()).some((e) => e.serial === serial),
      // The emulator waits up to 20 seconds for Android to shut down.
      { timeoutMs: 30_000, intervalMs: 1000 },
    ).catch(() => false)
    if (exited) return true
  }
  return false
}
