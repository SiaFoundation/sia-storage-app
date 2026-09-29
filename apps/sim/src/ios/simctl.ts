/**
 * The parts of `xcrun simctl` sim uses. Every simulator sim creates is named
 * `sia-sim-...`, which tells it apart from every other simulator on the
 * machine.
 */
import { $ } from 'bun'
import { runTool } from '../process'

export const SIM_PREFIX = 'sia-sim-'
const DEVICE_TYPE = 'iPhone 16 Pro'

/**
 * Runs `xcrun simctl`. A simulator that is still booting makes most commands
 * wait for the boot, however long it takes, so every command has a deadline.
 * `check: false` ignores a nonzero exit, for commands whose failure means the
 * work was already done, such as terminating an app that is not running.
 */
async function simctl(
  args: string[],
  opts: { timeoutMs?: number; check?: boolean } = {},
): Promise<string> {
  const out = await runTool(['xcrun', 'simctl', ...args], {
    timeoutMs: opts.timeoutMs ?? 60_000,
    check: opts.check,
    name: `simctl ${args.join(' ')}`,
  })
  return new TextDecoder().decode(out)
}

const BOOT_TIMEOUT_MS = 5 * 60_000

type SimDevice = { udid: string; name: string; state: string }

export async function listDevices(): Promise<SimDevice[]> {
  const out = await simctl(['list', 'devices', '--json'])
  const byRuntime = (JSON.parse(out) as { devices: Record<string, SimDevice[]> }).devices
  return Object.values(byRuntime).flat()
}

/** The newest installed iOS runtime, as a simctl runtime identifier. */
async function latestRuntime(): Promise<string> {
  const out = await simctl(['list', 'runtimes', '--json'])
  const runtimes = (
    JSON.parse(out) as {
      runtimes: Array<{
        identifier: string
        platform: string
        version: string
        isAvailable: boolean
      }>
    }
  ).runtimes.filter((r) => r.platform === 'iOS' && r.isAvailable)
  runtimes.sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }))
  const latest = runtimes.at(-1)
  if (!latest) throw new Error('No iOS simulator runtime is installed. Install one in Xcode.')
  return latest.identifier
}

export async function create(name: string): Promise<string> {
  const runtime = await latestRuntime()
  return (await simctl(['create', name, DEVICE_TYPE, runtime])).trim()
}

/**
 * Boots without opening the Simulator app. Returns once simctl lists the
 * device as booted, before it is usable.
 */
export async function startBoot(udid: string): Promise<void> {
  await simctl(['boot', udid], { check: false, timeoutMs: BOOT_TIMEOUT_MS })
}

/** Boots without opening the Simulator app, and waits until the device is usable. */
export async function boot(udid: string): Promise<void> {
  await startBoot(udid)
  await simctl(['bootstatus', udid, '-b'], { timeoutMs: BOOT_TIMEOUT_MS })
}

export async function shutdown(udid: string): Promise<void> {
  await simctl(['shutdown', udid], { check: false })
}

export async function remove(udid: string): Promise<void> {
  await simctl(['delete', udid], { check: false })
}

export async function install(udid: string, appPath: string): Promise<void> {
  await simctl(['install', udid, appPath], { timeoutMs: BOOT_TIMEOUT_MS })
}

/** Launches the app with launch arguments, which iOS puts in its argument defaults. */
export async function launch(udid: string, bundleId: string, args: string[]): Promise<void> {
  await simctl(['launch', udid, bundleId, ...args])
}

export async function terminate(udid: string, bundleId: string, timeoutMs?: number): Promise<void> {
  await simctl(['terminate', udid, bundleId], { check: false, timeoutMs })
}

/** Sends the app to the background by bringing Settings to the front. */
export async function openSettings(udid: string): Promise<void> {
  await simctl(['launch', udid, 'com.apple.Preferences'])
}

export async function screenshot(udid: string, path: string): Promise<void> {
  await simctl(['io', udid, 'screenshot', path])
}

/** The host path of the app's App Group container, where its database lives. */
export async function appGroupDir(udid: string, bundleId: string, group: string): Promise<string> {
  const out = await simctl(['get_app_container', udid, bundleId, 'groups'])
  const line = out.split('\n').find((l) => l.startsWith(group))
  if (!line) throw new Error(`App group ${group} not found for ${bundleId} on ${udid}`)
  return line.slice(group.length).trim()
}

/** The host pid of the app's process, or null when it is not running. */
export async function appPid(udid: string, executable: string): Promise<number | null> {
  const out = await $`pgrep -f ${`${udid}/.*/${executable}.app/${executable}`}`
    .quiet()
    .nothrow()
    .text()
  const pid = Number(out.trim().split('\n')[0])
  return Number.isFinite(pid) && pid > 0 ? pid : null
}

/**
 * Whether the simulator's process manager has suspended `pid` since `since`.
 * RunningBoard logs `Suspending task` for the pid when it freezes an app,
 * which is the only outside view of it: the process looks the same to ps.
 */
export async function wasSuspendedSince(udid: string, pid: number, since: Date): Promise<boolean> {
  const out = await logSince(
    udid,
    since,
    'process == "runningboardd" AND eventMessage CONTAINS "Suspending task"',
  )
  return out.includes(`:${pid}] Suspending task`)
}

/**
 * The simulator's unified log from two seconds before `since`, filtered by
 * `predicate`, in compact style. A failed read returns whatever `log show`
 * printed rather than throwing.
 */
export async function logSince(udid: string, since: Date, predicate: string): Promise<string> {
  const seconds = Math.ceil((Date.now() - since.getTime()) / 1000) + 2
  return simctl(
    [
      'spawn',
      udid,
      'log',
      'show',
      '--last',
      `${seconds}s`,
      '--style',
      'compact',
      '--predicate',
      predicate,
    ],
    { check: false },
  )
}

export async function uninstall(udid: string, bundleId: string): Promise<void> {
  await simctl(['uninstall', udid, bundleId], { check: false })
}

/**
 * Empties the simulator's keychain. The app keeps its account key there, and
 * iOS keeps keychain items across an uninstall, so a reinstalled app would
 * otherwise find the previous session's account.
 */
export async function resetKeychain(udid: string): Promise<void> {
  await simctl(['keychain', udid, 'reset'], { check: false })
}

/** The host path of the app's data container, whose Documents folder the app reads. */
export async function appDataDir(udid: string, bundleId: string): Promise<string> {
  return (await simctl(['get_app_container', udid, bundleId, 'data'])).trim()
}

/** Writes a boolean into the app's defaults, which it reads at launch. */
export async function setDefault(
  udid: string,
  bundleId: string,
  key: string,
  value: boolean,
): Promise<void> {
  await simctl(['spawn', udid, 'defaults', 'write', bundleId, key, '-bool', value ? 'YES' : 'NO'])
}

/** Adds image or video files to the simulator's photo library. */
export async function addMedia(udid: string, paths: string[]): Promise<void> {
  await simctl(['addmedia', udid, ...paths], { timeoutMs: 5 * 60_000 })
}
