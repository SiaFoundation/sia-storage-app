/**
 * What processes on this machine hold and wait for, across every checkout:
 * the desktop build (desktop-lock.ts), native builds, and the phone memory
 * budget (capacity.ts). Several checkouts can run sim and build at once on one
 * machine, and without this a build in one starves another's phones, or an
 * install in one replaces the app another is testing.
 *
 * A hold is a file under SIM_HOME holding a JSON record of the process that
 * took it. Like the pid locks in lock.ts it is free again as soon as that pid
 * is gone, so a killed holder never needs cleaning up. The record also says
 * what the holder is doing and from which checkout, which is what a waiter
 * prints and `sim status` lists. A process that waits records itself under
 * `waiting/` for the same reason.
 *
 * Holds use their own files rather than the pid-only lock files, since a
 * checkout on an older commit reads every lock file as a bare pid and would
 * take a JSON one over as stale.
 *
 * The desktop app's and the mobile app's build scripts import this file as
 * `@siastorage/sim/machine`, so it imports nothing beyond session.ts and its
 * own helpers.
 */
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { isAlive } from './process'
import { defaultSessionName, SIM_HOME } from './session'

export type Holder = {
  pid: number
  /** What the holder is doing, such as `ios-sim build` or `install Sia Storage Test`. */
  what: string
  /** The checkout it runs in, named the way that checkout's default session is. */
  checkout: string
  /** When it took the hold, as an ISO time. */
  since: string
}

export type Waiter = Holder & {
  /** What it waits for, such as `a native build slot`. */
  waitsFor: string
  /** Why it could not have it when it last looked, such as who holds it. */
  blockedBy: string
}

/** A record for this process. */
export function holderRecord(what: string): Holder {
  return { pid: process.pid, what, checkout: defaultSessionName(), since: new Date().toISOString() }
}

/**
 * A holder as a waiter prints it: what it does, where, and since when. The
 * start time rather than a duration, since a waiter prints again only when
 * this text changes.
 */
export function describeHolder(h: Holder): string {
  const since = new Date(h.since).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  })
  return `${h.what} in checkout ${h.checkout} (pid ${h.pid}, since ${since})`
}

function parse<T extends Holder>(text: string): T | null {
  try {
    const record = JSON.parse(text) as T
    return typeof record.pid === 'number' ? record : null
  } catch {
    return null
  }
}

/** The live holder of a hold file, or null when it is free or its holder has exited. */
export function readHold<T extends Holder = Holder>(path: string): T | null {
  const text = readText(path)
  if (text === null) return null
  const record = parse<T>(text)
  return record && isAlive(record.pid) ? record : null
}

/**
 * Takes the hold at `path` for `record` when it is free, and returns whether
 * it did. A hold whose holder has exited is removed and the take retried, so
 * the exclusive create stays the only way to take one.
 */
export function tryHold(path: string, record: Holder & Record<string, unknown>): boolean {
  mkdirSync(dirname(path), { recursive: true })
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(path, 'wx')
      writeSync(fd, JSON.stringify(record))
      closeSync(fd)
      return true
    } catch {
      const text = readText(path)
      if (text === null) continue
      const holder = parse(text)
      const mtime = statSync(path, { throwIfNoEntry: false })?.mtimeMs ?? 0
      // An unparsable file is a holder between its create and its write,
      // unless it is old enough that the holder died in between.
      const stale = holder ? !isAlive(holder.pid) : Date.now() - mtime > 5_000
      if (!stale) return false
      // Removed only if unchanged, as lock.ts does, so two waiters finding the
      // same stale hold cannot remove the one the first of them took since.
      if (readText(path) === text) rmSync(path, { force: true })
    }
  }
  return false
}

/** A hold file's text, or null once its holder has removed it. */
function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

/** Frees a hold this process took. A hold another process took since is left alone. */
export function releaseHold(path: string): void {
  if (readHold(path)?.pid === process.pid) rmSync(path, { force: true })
}

const WAITING = () => join(SIM_HOME, 'waiting')

/** Processes waiting on something right now, oldest first. */
export function waiters(): Waiter[] {
  const dir = WAITING()
  if (!existsSync(dir)) return []
  const found: Waiter[] = []
  for (const file of readdirSync(dir)) {
    const waiter = readHold<Waiter>(join(dir, file))
    if (waiter) found.push(waiter)
    else if (!isAlive(Number(file.split('-')[0]))) rmSync(join(dir, file), { force: true })
  }
  return found.sort((a, b) => a.since.localeCompare(b.since))
}

let waitSeq = 0

/**
 * Calls `attempt` until it returns a value, and while it says what blocks it
 * instead, such as who holds the thing, waits. The first wait prints what this
 * process waits for and what blocks it, and so does any change in that, so
 * whoever started the command can see what it is queued behind. The wait is
 * recorded for `sim status` until it ends.
 */
export async function waitInLine<T>(opts: {
  /** What is waited for, as a waiter prints it: `the Sia Storage Test build`. */
  waitsFor: string
  /** What this process is about to do with it. */
  what: string
  attempt: () => Promise<{ got: T } | { blockedBy: string }> | { got: T } | { blockedBy: string }
  timeoutMs: number
  intervalMs?: number
  signal?: AbortSignal
  log?: (line: string) => void
}): Promise<T> {
  const log = opts.log ?? ((line: string) => console.error(line))
  const deadline = Date.now() + opts.timeoutMs
  const file = join(WAITING(), `${process.pid}-${waitSeq++}.json`)
  let told: string | null = null
  try {
    for (;;) {
      const result = await opts.attempt()
      if ('got' in result) return result.got
      if (result.blockedBy !== told) {
        log(`Waiting for ${opts.waitsFor}: ${result.blockedBy}`)
        told = result.blockedBy
        mkdirSync(WAITING(), { recursive: true })
        const waiter: Waiter = {
          ...holderRecord(opts.what),
          waitsFor: opts.waitsFor,
          blockedBy: result.blockedBy,
        }
        writeFileSync(file, JSON.stringify(waiter))
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `Gave up after ${Math.round(opts.timeoutMs / 60_000)} minutes waiting for ${opts.waitsFor}: ${result.blockedBy}`,
        )
      }
      const until = Math.min(deadline, Date.now() + (opts.intervalMs ?? 2000))
      while (Date.now() < until) {
        if (opts.signal?.aborted) throw new Error(`Stopped waiting for ${opts.waitsFor}`)
        await Bun.sleep(Math.min(250, until - Date.now()))
      }
    }
  } finally {
    rmSync(file, { force: true })
  }
}

const BUILDS = () => join(SIM_HOME, 'builds')

/**
 * How many native builds run at once on this machine, `SIM_NATIVE_BUILDS` or 1.
 * One Xcode or Gradle build already uses every core, and a second beside it
 * mostly adds the memory it holds, which is what phones and the desktop app
 * then wait on.
 */
export function buildLimit(): number {
  const set = Number(process.env.SIM_NATIVE_BUILDS)
  return Number.isInteger(set) && set > 0 ? set : 1
}

/** The native builds running now. */
export function buildHolders(): Holder[] {
  const dir = BUILDS()
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.hold'))
    .map((f) => readHold(join(dir, f)))
    .filter((h): h is Holder => h !== null)
}

/**
 * Waits until one of the machine's build slots is free and takes it for a
 * native build, `what`, and returns the slot. It is freed by `releaseHold` or
 * when this process exits, so a build script that ends in `process.exit`
 * needs no cleanup. Builds from every checkout share the slots, so they queue
 * rather than starve booted phones of memory.
 */
export function takeBuildSlot(what: string): Promise<string> {
  const limit = buildLimit()
  const record = holderRecord(what)
  return waitInLine<string>({
    waitsFor: `a native build slot (${limit} on this machine, SIM_NATIVE_BUILDS)`,
    what,
    timeoutMs: 2 * 60 * 60_000,
    attempt: () => {
      for (let i = 0; i < limit; i++) {
        const path = join(BUILDS(), `slot-${i}.hold`)
        if (tryHold(path, record)) return { got: path }
      }
      const held = buildHolders().map((h) => describeHolder(h))
      return { blockedBy: `held by ${held.join(', ') || 'a build that just finished'}` }
    },
  })
}

/** Runs a native build, `what`, in a build slot, which it holds until the build ends. */
export async function withBuildSlot<T>(what: string, build: () => Promise<T>): Promise<T> {
  const slot = await takeBuildSlot(what)
  try {
    return await build()
  } finally {
    releaseHold(slot)
  }
}
