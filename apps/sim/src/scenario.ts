/**
 * A scenario is a saved, repeatable check across real app processes. It
 * declares the devices it needs and runs steps against them, recording each
 * check as it goes. The runner gives every scenario a fresh network, fresh CLI
 * and desktop devices, and phones with the app installed again. A pooled
 * phone keeps its photo library from the scenario that held it before.
 */
import { isDeepStrictEqual } from 'node:util'
import type { NetworkControl } from '@siastorage/mock-network/control'
import { waitForConvergence } from './converge'
import { contentMismatches } from './integrity'
import type { CliDevice, DesktopDevice, Device, PhoneDevice } from './devices'
import { addTyped, type NameStyle, seedTypedFiles, type TypedFile } from './filetypes'
import { seedFiles } from './seed'
import { capture } from './evidence'
import type { PhoneKind, Session } from './session'
import type { StandardCheck } from './standard'
import { asAppTimeout, Cancelled, type waitFor, waitForApp } from './wait'

export type CheckRecord = {
  label: string
  ok: boolean
  detail?: string
  /** What a failed check saw, where the check compared a value. */
  actual?: unknown
}

/**
 * One check a bug fails, by its exact label. `got` is the value the check sees
 * while the bug is present, and `matches` tests that value where it changes
 * from run to run. A bare label is for a check whose failure can only be the
 * bug. `sometimes` marks a check the bug fails on some runs only, which may
 * pass, but which fails only as its entry says.
 */
export type BugCheck =
  | string
  | { check: string; got: unknown; sometimes?: true }
  | { check: string; matches: (actual: never) => boolean; sometimes?: true }

/**
 * A scenario could not set up the situation it tests, such as a kill landing
 * after the work it was meant to interrupt. The run reports ERROR, since it
 * shows nothing about the behavior either way.
 */
export class PreconditionFailed extends Error {}
export type StepRecord = { name: string; ms: number; ok: boolean; error?: string }

/**
 * A device a scenario asks for. `phone` runs on whichever platform the run
 * chooses (`sim run --phone ios|android`), so one scenario covers both.
 * `desktop` is the installed desktop app on this Mac, and a scenario asking
 * for one is skipped on a machine that has none.
 */
type ScenarioDeviceKind = 'cli' | 'phone' | 'desktop'

export type DeviceMap = Record<string, ScenarioDeviceKind>

export type ScenarioDevices<M extends DeviceMap> = {
  [N in keyof M]: M[N] extends 'cli'
    ? CliDevice
    : M[N] extends 'desktop'
      ? DesktopDevice
      : PhoneDevice
}

export type ScenarioContext<M extends DeviceMap> = {
  network: NetworkControl
  devices: ScenarioDevices<M>
  /** A scratch directory for files the scenario creates. */
  workDir: string
  /** Runs one named phase of the scenario. A throw ends the scenario. */
  step<T>(name: string, fn: () => Promise<T>): Promise<T>
  /**
   * Runs a step that sets up what the scenario tests. If it throws or returns
   * false the scenario ends as ERROR rather than FAIL, because the behavior
   * was never exercised.
   */
  precondition<T>(name: string, fn: () => Promise<T>): Promise<T>
  /** Records a check. A failed check fails the scenario but does not stop it. */
  check(label: string, ok: boolean, detail?: string): boolean
  /** Records a check that `actual` deep-equals `expected`. */
  checkEqual<T>(label: string, actual: T, expected: T): boolean
  /**
   * Waits for the apps to reach a state. A timeout fails the scenario, so a
   * wait for the setup the scenario needs belongs in a `precondition`.
   */
  waitFor: typeof waitFor
  /** Waits until the named devices, or all of them, agree and have nothing left to upload. */
  converge(
    names?: Array<keyof M & string>,
    opts?: { timeoutMs?: number },
  ): Promise<{ files: number; waitedMs: number }>
  /** Writes `count` unique files of `size` bytes and adds them to `device`. */
  seed(
    device: keyof M & string,
    opts: { count: number; size: number; prefix?: string; dir?: string },
  ): Promise<Array<{ id: string; name: string; path: string }>>
  /**
   * Writes real files of the types `types` names, `all`, a category such as
   * `image`, a MIME type or an extension, and adds them to `device`. Each comes
   * back with the name style it got and the type a device should store for it.
   */
  seedTypes(
    device: keyof M & string,
    opts: {
      types: string[]
      count?: number
      names?: NameStyle | NameStyle[] | 'mixed'
      dir?: string
    },
  ): Promise<TypedFile[]>
  /**
   * Checks that every uploaded file on the named devices, or all of them,
   * points at an object holding its own bytes. A device with no uploaded file
   * fails the check, since it proves nothing.
   */
  checkContent(names?: Array<keyof M & string>): Promise<boolean>
  /** Records a note in the report. */
  note(message: string): void
  /**
   * Saves what each named device, or every device, shows now under the
   * session's evidence/<label>, and notes where. A failed or kept run keeps it.
   */
  capture(label: string, names?: Array<keyof M & string>): Promise<void>
}

export type Scenario<M extends DeviceMap = DeviceMap> = {
  name: string
  /** What the scenario proves, in a sentence a reviewer can check against the steps. */
  description: string
  devices: M
  timeoutMs?: number
  /**
   * The product bug this scenario currently catches, in a sentence. A failing
   * run reports KNOWN_BUG and does not fail the suite. A passing run reports
   * FIXED and does fail it, so whoever fixed the bug removes this line. A bug
   * on one phone platform only is given per platform.
   */
  knownBug?: string | Partial<Record<PhoneKind, string>>
  /**
   * A product bug this scenario catches on some runs only, such as a race,
   * which a later diff in the same stack fixes. A run where it shows reports
   * KNOWN_BUG, and one where it does not reports PASS rather than FIXED, since
   * a pass does not show a race is gone. The diff with the fix removes this
   * line, and from then on the scenario has to pass every run.
   */
  intermittentBug?: string | Partial<Record<PhoneKind, string>>
  /**
   * The checks the known or intermittent bug fails. A failed run reports
   * KNOWN_BUG only when the scenario ran to its end, every check listed here
   * failed as its entry says, and no other check failed. Anything else
   * reports FAIL, so a timeout, a crash or a second bug in the same scenario
   * is never taken for this one. A bug given per platform lists its checks
   * per platform. Required with a bug, and refused without one.
   */
  bugShowsAs?: BugCheck[] | Partial<Record<PhoneKind, BugCheck[]>>
  /**
   * Standard checks this scenario breaks on purpose, each with the reason,
   * such as a device it leaves offline at the end. Every other standard check
   * runs after the scenario's own steps.
   */
  skipStandardChecks?: Partial<Record<StandardCheck, string>>
  /**
   * The behavior this scenario asserts is what the apps do now, and nobody has
   * decided it is what they should do. The sentence says what to decide. The
   * scenario passes or fails as usual, and the report lists it for review.
   */
  needsReview?: string
  run(ctx: ScenarioContext<M>): Promise<void>
}

export function defineScenario<M extends DeviceMap>(scenario: Scenario<M>): Scenario<M> {
  const platforms = new Set<PhoneKind>()
  for (const bug of [scenario.knownBug, scenario.intermittentBug]) {
    if (typeof bug === 'string') {
      platforms.add('ios')
      platforms.add('android')
    } else if (bug) {
      for (const phone of Object.keys(bug) as PhoneKind[]) platforms.add(phone)
    }
  }
  if (platforms.size === 0 && scenario.bugShowsAs) {
    throw new Error(`${scenario.name}: bugShowsAs describes no bug, so it goes with the bug`)
  }
  for (const phone of platforms) {
    if (!bugShape(scenario.bugShowsAs, phone)?.length) {
      throw new Error(`${scenario.name}: the bug on ${phone} needs bugShowsAs`)
    }
  }
  return scenario
}

/** The checks a scenario's bug fails on `phone`. */
export function bugShape(
  showsAs: Scenario<DeviceMap>['bugShowsAs'],
  phone: PhoneKind,
): BugCheck[] | undefined {
  return Array.isArray(showsAs) ? showsAs : showsAs?.[phone]
}

export function createContext<M extends DeviceMap>(opts: {
  session: Session
  network: NetworkControl
  devices: ScenarioDevices<M>
  workDir: string
  checks: CheckRecord[]
  steps: StepRecord[]
  notes: string[]
  /** Aborted when the run gives up on the scenario, which then stops at its next step or wait. */
  signal: AbortSignal
}): ScenarioContext<M> {
  const { checks, steps, notes, signal } = opts
  const wait: typeof waitFor = (what, probe, waitOpts = {}) =>
    waitForApp(what, probe, { ...waitOpts, signal })
  const devices = Object.fromEntries(
    Object.entries(opts.devices).map(([name, device]) => [name, cancellable(device, signal)]),
  ) as ScenarioDevices<M>
  const record = (label: string, ok: boolean, detail?: string, actual?: unknown) => {
    checks.push({
      label,
      ok,
      ...(detail && !ok ? { detail } : {}),
      ...(actual !== undefined && !ok ? { actual } : {}),
    })
    return ok
  }
  let seedRun = 0
  const ctx: ScenarioContext<M> = {
    network: opts.network,
    devices,
    workDir: opts.workDir,
    async step(name, fn) {
      if (signal.aborted) throw new Cancelled(`Cancelled before ${name}`)
      const started = Date.now()
      try {
        const value = await fn()
        steps.push({ name, ms: Date.now() - started, ok: true })
        return value
      } catch (e) {
        steps.push({
          name,
          ms: Date.now() - started,
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        })
        throw e
      }
    },
    async precondition(name, fn) {
      const value = await ctx.step(name, fn).catch((e: unknown) => {
        if (e instanceof Cancelled) throw e
        throw new PreconditionFailed(`${name}: ${e instanceof Error ? e.message : String(e)}`)
      })
      if (value === false) {
        steps[steps.length - 1] = { ...steps[steps.length - 1], ok: false, error: 'did not hold' }
        throw new PreconditionFailed(`${name}: did not hold`)
      }
      return value
    },
    check(label, ok, detail) {
      return record(label, ok, detail)
    },
    checkEqual(label, actual, expected) {
      if (isDeepStrictEqual(actual, expected)) return record(label, true)
      return record(
        label,
        false,
        `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
        actual,
      )
    },
    waitFor: wait,
    converge(names, convergeOpts) {
      const chosen = (names ?? deviceNames(devices)).map((n) => devices[n] as Device)
      return waitForConvergence(chosen, { ...convergeOpts, signal }).catch(asAppTimeout)
    },
    async seed(device, seedOpts) {
      const dir = `${opts.workDir}/seed-${++seedRun}`
      const paths = seedFiles(dir, {
        count: seedOpts.count,
        size: seedOpts.size,
        prefix: seedOpts.prefix ?? `${device}-${seedRun}`,
      })
      const added = []
      for (const path of paths) {
        const file = await (devices[device] as Device).addFile(path, { dir: seedOpts.dir })
        added.push({ ...file, path })
      }
      return added
    },
    async seedTypes(device, typeOpts) {
      const dir = `${opts.workDir}/seed-${++seedRun}`
      const files = await seedTypedFiles(dir, {
        types: typeOpts.types,
        count: typeOpts.count ?? 1,
        names: typeOpts.names ?? 'mixed',
        prefix: `${device}-${seedRun}`,
      })
      await addTyped(devices[device] as Device, files, { dir: typeOpts.dir, signal })
      return files
    },
    async checkContent(names) {
      let ok = true
      for (const name of names ?? deviceNames(devices)) {
        const { checked, problems } = await contentMismatches(devices[name] as Device, opts.network)
        ok =
          record(
            `every file on ${name} points at an object holding its own bytes`,
            checked > 0 && problems.length === 0,
            checked === 0 ? 'no uploaded files to check' : problems.slice(0, 10).join('; '),
            problems,
          ) && ok
      }
      return ok
    },
    async capture(label, names) {
      for (const name of names ?? deviceNames(devices)) {
        const dir = await capture(opts.session, name, devices[name] as Device, label)
        notes.push(`captured ${name} at ${label}: ${dir}`)
      }
    },
    note(message) {
      notes.push(message)
    },
  }
  return ctx
}

function deviceNames<M extends DeviceMap>(devices: ScenarioDevices<M>): Array<keyof M & string> {
  return Object.keys(devices) as Array<keyof M & string>
}

/**
 * The device with every method throwing Cancelled once the run gives up on
 * the scenario, so a scenario past its deadline stops at its next device call
 * instead of starting or killing apps while teardown runs. The screen `ui()`
 * returns is wrapped the same way, since a scenario holds it across steps and
 * would otherwise keep tapping after the deadline.
 */
function cancellable<T extends object>(device: T, signal: AbortSignal): T {
  return new Proxy(device, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target)
      if (typeof value !== 'function') return value
      return (...args: unknown[]) => {
        if (signal.aborted) throw new Cancelled(`Cancelled before ${String(prop)}`)
        const result = value.apply(target, args)
        return prop === 'ui' ? cancellable(result as object, signal) : result
      }
    },
  })
}
