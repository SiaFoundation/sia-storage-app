/**
 * The parts of `adb` sim uses, each bound to one emulator by serial so a
 * command can never land on another device, including a phone plugged in by
 * USB.
 */
import { join } from 'node:path'
import { runTool } from '../process'

/** Where Android Studio puts the SDK when neither variable says otherwise. */
const DEFAULT_SDK = process.platform === 'darwin' ? 'Library/Android/sdk' : join('Android', 'Sdk')
const SDK =
  process.env.ANDROID_HOME ??
  process.env.ANDROID_SDK_ROOT ??
  join(process.env.HOME ?? '', DEFAULT_SDK)
export const ADB = join(SDK, 'platform-tools/adb')
export const EMULATOR = join(SDK, 'emulator/emulator')
export const AVDMANAGER = join(SDK, 'cmdline-tools/latest/bin/avdmanager')
export const SYSTEM_IMAGES = join(SDK, 'system-images')

/** Quotes a value for the device's shell, so paths with spaces stay one argument. */
export function q(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/**
 * An adb command against a wedged emulator can block forever, so every command
 * has a deadline, long enough for installing the app or pushing a large file.
 */
const DEFAULT_TIMEOUT_MS = 60_000
const TRANSFER_TIMEOUT_MS = 5 * 60_000

/**
 * How long a command waits out adb losing the emulator. adb's connection to
 * an emulator can drop and reconnect in a few seconds, and a command sent
 * meanwhile fails with the device offline, not found, or the connection
 * closed.
 */
const OFFLINE_GRACE_MS = 20_000

export function adb(serial: string) {
  const run = async (args: string[], timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Uint8Array> => {
    const deadline = Date.now() + OFFLINE_GRACE_MS
    for (;;) {
      try {
        return await runOnce(args, timeoutMs)
      } catch (e) {
        const offline =
          e instanceof Error &&
          / failed: (adb: |error: )?(device offline|device '.*' not found|closed)$/.test(e.message)
        if (!offline || Date.now() > deadline) throw e
        await Bun.sleep(1000)
      }
    }
  }
  const runOnce = (args: string[], timeoutMs: number) =>
    runTool([ADB, '-s', serial, ...args], {
      timeoutMs,
      name: `adb -s ${serial} ${args.join(' ')}`,
    })
  const text = async (args: string[]) => new TextDecoder().decode(await run(args))
  return {
    shell: (command: string) => text(['shell', command]),
    /** Runs a shell command as the app's own user, which a debuggable build allows. */
    runAs: (pkg: string, command: string) => text(['shell', `run-as ${pkg} sh -c ${q(command)}`]),
    /** Reads a file in the app's sandbox as raw bytes. */
    readAs: (pkg: string, path: string) =>
      run(['exec-out', `run-as ${pkg} cat ${q(path)}`], TRANSFER_TIMEOUT_MS),
    push: async (local: string, remote: string) => {
      await run(['push', local, remote], TRANSFER_TIMEOUT_MS)
    },
    install: async (apk: string) => {
      await run(['install', '-r', '-t', apk], TRANSFER_TIMEOUT_MS)
    },
    /** Removes the app, and succeeds if it was not installed. */
    uninstall: async (pkg: string) => {
      await run(['uninstall', pkg]).catch(() => {})
    },
    screencap: () => run(['exec-out', 'screencap', '-p']),
    logcat: (args: string[]) => text(['logcat', ...args]),
  }
}

/** Runs a command that is not bound to one emulator, with the same deadline. */
export async function tool(
  args: string[],
  opts: { timeoutMs?: number; env?: Record<string, string | undefined> } = {},
): Promise<string> {
  const out = await runTool(args, {
    timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    env: opts.env,
  })
  return new TextDecoder().decode(out)
}

/**
 * Every emulator adb knows of, by state. One still booting or starting up is
 * `offline` for a while, and still holds its console port.
 */
export async function listEmulators(): Promise<Array<{ serial: string; state: string }>> {
  const out = await tool([ADB, 'devices'])
  return out
    .split('\n')
    .map((l) => l.split('\t'))
    .filter(([serial]) => serial?.startsWith('emulator-'))
    .map(([serial, state]) => ({ serial, state: state?.trim() ?? '' }))
}
