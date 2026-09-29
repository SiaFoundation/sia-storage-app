/**
 * Runs scenario files. Each scenario gets its own session, network and devices,
 * and its devices and network are always torn down afterwards. The session
 * directory is deleted too, unless the scenario neither passed nor was
 * skipped, or `keep` is set, in which case it stays for inspection and the
 * report names it.
 */
import { Glob } from 'bun'
import { mkdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { addDevice, type Device, PhoneStartFailed } from './devices'
import { desktopUnavailable } from './devices/desktop'
import { networkControl, startNetwork, stopNetwork } from './network'
import {
  progressOf,
  type RunReport,
  type ScenarioResult,
  type Verdict,
  writeProgress,
  writeReport,
} from './report'
import {
  type CheckRecord,
  createContext,
  type DeviceMap,
  PreconditionFailed,
  type Scenario,
  type ScenarioDevices,
  type StepRecord,
} from './scenario'
import { type PhoneKind, REPO_ROOT, SIM_HOME, Session } from './session'
import { type StartOutcome, unstartable } from './unstartable'
import { AppTimeout } from './wait'

const SCENARIO_DIR = join(REPO_ROOT, 'apps/sim/scenarios')

export async function findScenarios(filters: string[]): Promise<string[]> {
  const files: string[] = []
  for await (const file of new Glob('**/*.scenario.ts').scan(SCENARIO_DIR)) {
    files.push(join(SCENARIO_DIR, file))
  }
  files.sort()
  if (filters.length === 0) return files
  return files.filter((f) => filters.some((filter) => relative(SCENARIO_DIR, f).includes(filter)))
}

/** A scenario whose devices this machine cannot run. */
class Skipped extends Error {}

/** A scenario not started because its kind of phone failed to start twice in a row. */
class GaveUp extends Error {}

/** The scenario's own name, or its path when the file does not load. */
async function scenarioName(file: string): Promise<string> {
  try {
    return ((await import(file)).default as Scenario).name
  } catch {
    return relative(SCENARIO_DIR, file)
  }
}

type RunOptions = {
  keep?: boolean
  realTimers?: boolean
  /** Scenarios to run at once. Each has its own network, ports and data dirs. */
  jobs?: number
  /** The platform a scenario's `phone` devices run on. */
  phone?: PhoneKind
  onResult?: (r: ScenarioResult) => void
  /** A file rewritten with the run's progress at its start and as scenarios start and end. */
  progressFile?: string
}

export async function runScenarios(
  files: string[],
  opts: RunOptions,
): Promise<{ report: RunReport; paths: { json: string; md: string }; cancelled: boolean }> {
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 6)}`
  const started = Date.now()
  const results: ScenarioResult[] = new Array(files.length)
  let next = 0
  const reportDir = join(SIM_HOME, 'runs', runId)
  const git = await gitState()
  const snapshot = (): RunReport => ({
    runId,
    ...git,
    startedAt: new Date(started).toISOString(),
    ms: Date.now() - started,
    results: results.filter(Boolean),
  })
  // A Ctrl-C stops the workers taking new scenarios and cancels the ones
  // running, each of which then tears down and records its result, and the
  // run exits once the partial report is written.
  let cancelled = false
  /** Each scenario still running, by its index in `files`. */
  const running = new Map<number, { name: string; startedAt: number }>()
  /** What each finished scenario that needed a phone showed about starting one, in order. */
  const starts: StartOutcome[] = []
  let latest: ScenarioResult | undefined
  const progress = () => {
    if (!opts.progressFile) return
    const names = [...running.values()].map((r) => r.name)
    writeProgress(
      opts.progressFile,
      progressOf(files.length, results.filter(Boolean), names, latest),
    )
  }
  const cannotStart = (needs: PhoneKind[]): string | undefined => {
    const stuck = unstartable(starts)
    const kind = needs.find((k) => stuck.has(k))
    return kind && `skipped: ${kind} phones could not start: ${stuck.get(kind)}`
  }
  progress()
  const worker = async () => {
    while (next < files.length && !cancelled) {
      const index = next++
      running.set(index, { name: await scenarioName(files[index]), startedAt: Date.now() })
      progress()
      const { result, start } = await runOne(
        files[index],
        `run-${runId}-${index}`,
        opts,
        cannotStart,
      )
      results[index] = result
      if (start) starts.push(start)
      running.delete(index)
      latest = result
      opts.onResult?.(result)
      // Rewritten after every scenario, so a long run can be read while it goes.
      writeReport(reportDir, snapshot())
      progress()
    }
  }
  const workers = Promise.all(Array.from({ length: Math.max(1, opts.jobs ?? 1) }, worker))
  const stopOnSignal = () => {
    cancelled = true
    for (const entry of active) entry.controller.abort()
    // A scenario in the middle of a device call only sees the abort when the
    // call returns, so it gets a minute to record its result and tear down.
    // Past that the teardown is forced and the run exits here.
    void Promise.race([workers.then(() => false), Bun.sleep(60_000).then(() => true)]).then(
      async (forced) => {
        if (!forced) return
        // A device whose stop hangs must not keep the run from exiting.
        await withDeadline(teardownActive(), 60_000, 'the forced teardown').catch(() => {})
        for (const [index, { name, startedAt }] of running) {
          results[index] = {
            file: relative(REPO_ROOT, files[index]),
            name,
            description: '',
            verdict: 'ERROR',
            ms: Date.now() - startedAt,
            steps: [],
            checks: [],
            notes: [],
            error: 'Still running a minute after Ctrl-C, so its teardown was forced',
          }
        }
        running.clear()
        writeReport(reportDir, snapshot())
        progress()
        process.exit(130)
      },
    )
  }
  process.once('SIGINT', stopOnSignal)
  process.once('SIGTERM', stopOnSignal)
  try {
    await workers
  } finally {
    process.off('SIGINT', stopOnSignal)
    process.off('SIGTERM', stopOnSignal)
  }
  const report = snapshot()
  const paths = writeReport(reportDir, report)
  return { report, paths, cancelled }
}

type ActiveRun = {
  session: Session
  devices: Record<string, Device>
  /** Aborted to stop the scenario, which ends at its next step or wait. */
  controller: AbortController
}

/** Runs whose devices may still be running, for a Ctrl-C to tear down. */
const active = new Set<ActiveRun>()
const teardowns = new WeakMap<ActiveRun, Promise<void>>()

/** Tears `entry` down once, however many callers ask, and resolves when it is done. */
function teardown(entry: ActiveRun): Promise<void> {
  let done = teardowns.get(entry)
  if (!done) {
    done = (async () => {
      entry.controller.abort()
      for (const device of Object.values(entry.devices)) {
        await device.stop().catch(() => device.kill().catch(() => {}))
        await device.dispose?.().catch(() => {})
      }
      await stopNetwork(entry.session).catch(() => {})
      active.delete(entry)
    })()
    teardowns.set(entry, done)
  }
  return done
}

async function teardownActive(): Promise<void> {
  await Promise.all([...active].map(teardown))
}

/**
 * The verdict once a scenario's known or intermittent bug is accounted for.
 * A failed run whose every failure, a failed check's label or the first line
 * of the error, contains one of `showsAs` is the bug, KNOWN_BUG. A failure
 * that matches none stays FAIL and is returned as unexplained. A pass under a
 * steady bug is FIXED, and under an intermittent one stays PASS.
 */
export function bugVerdict(
  verdict: Verdict,
  bug: { steady: boolean; intermittent: boolean; showsAs: string[]; failures: string[] },
): { verdict: Verdict; unexplained: string[] } {
  if (!bug.steady && !bug.intermittent) return { verdict, unexplained: [] }
  if (verdict === 'PASS') return { verdict: bug.steady ? 'FIXED' : 'PASS', unexplained: [] }
  if (verdict !== 'FAIL') return { verdict, unexplained: [] }
  const unexplained = bug.failures.filter((f) => !bug.showsAs.some((part) => f.includes(part)))
  return { verdict: unexplained.length === 0 ? 'KNOWN_BUG' : 'FAIL', unexplained }
}

function bugFor(
  bug: Scenario['knownBug'] | Scenario['intermittentBug'],
  phone: PhoneKind,
): string | undefined {
  return typeof bug === 'string' ? bug : bug?.[phone]
}

/**
 * Starts every device before the scenario's first step, and rejects only once
 * all have settled. A phone's failure wins over another device's, since it is
 * the one the run counts toward giving up on phones. A phone app that
 * crashes here is relaunched once, since the scenario has not yet asked
 * anything of it, and the crash is listed in the result rather than dropped.
 * A start the scenario makes itself, such as a relaunch after a kill, gets no
 * second try, because that crash can be the bug under test.
 */
async function startAll(devices: Device[]): Promise<void> {
  const results = await Promise.allSettled(
    devices.map((d) => d.start({ relaunchAfterCrash: true })),
  )
  const rejected = results.flatMap((r) => (r.status === 'rejected' ? [r.reason] : []))
  if (rejected.length > 0) {
    throw rejected.find((e) => e instanceof PhoneStartFailed) ?? rejected[0]
  }
}

/**
 * Runs the scenario until it finishes or its deadline. Past the deadline the
 * scenario is cancelled: every step, wait and device call it starts afterwards
 * throws, and teardown waits up to 30 seconds for it to stop. A device call
 * already running when the deadline passes can still outlast that wait. A UI
 * driver it holds stops working once teardown hands its phone back.
 */
async function runWithDeadline(
  scenario: Scenario,
  ctx: Parameters<Scenario['run']>[0],
  controller: AbortController,
): Promise<void> {
  const run = scenario.run(ctx)
  try {
    await withDeadline(run, scenario.timeoutMs ?? 5 * 60_000, scenario.name)
  } catch (e) {
    controller.abort()
    await Promise.race([run.catch(() => {}), Bun.sleep(30_000)])
    throw e
  }
}

/**
 * Runs one scenario and returns its result, and for a scenario that needed a
 * phone and tried to start it, what that showed about starting one.
 * `cannotStart` says why a scenario needing those phone kinds should not
 * start at all.
 */
async function runOne(
  file: string,
  sessionName: string,
  opts: RunOptions,
  cannotStart: (needs: PhoneKind[]) => string | undefined,
): Promise<{ result: ScenarioResult; start?: StartOutcome }> {
  const started = Date.now()
  const checks: CheckRecord[] = []
  const steps: StepRecord[] = []
  const notes: string[] = []
  const session = Session.create(sessionName, { fastTimers: !opts.realTimers })
  const devices: Record<string, Device> = {}
  const entry: ActiveRun = { session, devices, controller: new AbortController() }
  active.add(entry)
  let scenario: Scenario | undefined
  let setUp = false
  let verdict: Verdict = 'PASS'
  let error: string | undefined
  let diagnostics: Record<string, unknown> | undefined
  let starting: Promise<void> | undefined
  let needs: PhoneKind[] = []
  let gaveUp = false
  let startFailure: StartOutcome['failed']

  try {
    scenario = (await import(file)).default as Scenario
    if (Object.values(scenario.devices).includes('desktop')) {
      const unavailable = desktopUnavailable()
      if (unavailable) throw new Skipped(unavailable)
    }
    needs = Object.values(scenario.devices).includes('phone') ? [opts.phone ?? 'ios'] : []
    const why = cannotStart(needs)
    if (why) throw new GaveUp(why)
    await startNetwork(session)
    for (const [name, kind] of Object.entries(scenario.devices)) {
      devices[name] = await addDevice(
        session,
        name,
        kind === 'phone' ? (opts.phone ?? 'ios') : kind,
      )
    }
    // A phone's first start can build WebDriverAgent or boot a simulator, so
    // the deadline is long, but a wedged start must not hang the run.
    starting = startAll(Object.values(devices))
    await withDeadline(starting, 15 * 60_000, 'the devices to start')
    setUp = true
    const workDir = join(session.dir, 'work')
    mkdirSync(workDir, { recursive: true })
    const ctx = createContext({
      session,
      network: networkControl(session),
      devices: devices as ScenarioDevices<DeviceMap>,
      workDir,
      checks,
      steps,
      notes,
      signal: entry.controller.signal,
    })
    await runWithDeadline(scenario, ctx, entry.controller)
    // A scenario that records no check would pass, or report FIXED under knownBug,
    // having shown nothing about the apps. With no failed check, the catch reports ERROR.
    if (checks.length === 0) throw new Error('The scenario finished without recording a check')
    if (checks.some((c) => !c.ok)) verdict = 'FAIL'
  } catch (e) {
    if (e instanceof Skipped) {
      verdict = 'SKIP'
      notes.push(e.message)
    } else if (e instanceof GaveUp) {
      verdict = 'ERROR'
      error = e.message
      gaveUp = true
    } else {
      // Only a start during setup counts toward the run giving up on phones.
      // A relaunch the scenario makes itself, such as after a kill, can fail
      // because of the bug the scenario is there to catch.
      if (e instanceof PhoneStartFailed && !setUp) {
        startFailure = { kind: e.kind, reason: e.message.split('\n')[0] }
      } else if (e instanceof DeadlinePassed && !setUp && needs[0]) {
        // A phone that hangs at start, such as one waiting for memory or a
        // boot that never ends, is as unstartable as one that fails.
        startFailure = { kind: needs[0], reason: e.message }
      }
      // Only a scenario that got past setup and then saw the apps misbehave is
      // a FAIL. A device that never started, a precondition that did not hold,
      // or a call that threw leaves the behavior untested.
      const productFailure =
        setUp &&
        !(e instanceof PreconditionFailed) &&
        (e instanceof AppTimeout || checks.some((c) => !c.ok))
      verdict = productFailure ? 'FAIL' : 'ERROR'
      error = e instanceof Error ? (e.stack ?? e.message) : String(e)
    }
  }

  // A Ctrl-C can let the scenario run to its end with steps skipped, and what
  // it recorded then says nothing either way.
  if (entry.controller.signal.aborted && !error) {
    verdict = 'ERROR'
    error = 'Cancelled before the scenario finished'
  }
  const phoneKind = opts.phone ?? 'ios'
  const steadyBug = bugFor(scenario?.knownBug, phoneKind)
  const intermittentBug = steadyBug ? undefined : bugFor(scenario?.intermittentBug, phoneKind)
  const knownBug = steadyBug ?? intermittentBug
  const judged = bugVerdict(verdict, {
    steady: steadyBug !== undefined,
    intermittent: intermittentBug !== undefined,
    showsAs: scenario?.bugShowsAs ?? [],
    failures: [
      ...checks.filter((c) => !c.ok).map((c) => c.label),
      ...(error ? [error.split('\n')[0]] : []),
    ],
  })
  verdict = judged.verdict
  if (judged.unexplained.length > 0) {
    notes.push(`not the known bug: ${judged.unexplained.join('; ')}`)
  }
  // A scenario that was never started has nothing in its session to read.
  const keep = !gaveUp && (opts.keep || (verdict !== 'PASS' && verdict !== 'SKIP'))
  // A kept session is kept to be read, and a phone's database and log live
  // in its simulator or emulator, which the next run wipes, so they are
  // copied in whenever the session stays.
  if (keep) diagnostics = await collectDiagnostics(session, devices)
  // A start past its deadline can still lease a simulator or emulator, which
  // teardown would miss if it ran first, so it gets two more minutes to end.
  if (starting) await Promise.race([starting.catch(() => {}), Bun.sleep(120_000)])
  await teardown(entry)
  if (!keep) session.remove()

  const startCrashes = Object.entries(devices).flatMap(([name, d]) =>
    (d.startCrashes ?? []).map((crash) => `${name}: ${crash}`),
  )
  const result: ScenarioResult = {
    file: relative(REPO_ROOT, file),
    name: scenario?.name ?? relative(SCENARIO_DIR, file),
    description: scenario?.description ?? '',
    ...(knownBug ? { knownBug } : {}),
    ...(intermittentBug ? { intermittent: true } : {}),
    ...(scenario?.needsReview ? { needsReview: scenario.needsReview } : {}),
    ...(startCrashes.length > 0 ? { startCrashes } : {}),
    verdict,
    ms: Date.now() - started,
    steps,
    checks,
    notes,
    ...(error ? { error } : {}),
    ...(keep ? { sessionDir: session.dir } : {}),
    ...(diagnostics ? { diagnostics } : {}),
  }
  const tried = needs.length > 0 && starting !== undefined
  return { result, ...(tried ? { start: { needs, failed: startFailure } } : {}) }
}

async function collectDiagnostics(
  session: Session,
  devices: Record<string, Device>,
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {}
  try {
    out.network = await withDeadline(
      networkControl(session).summary(),
      10_000,
      'the network summary',
    )
  } catch (e) {
    out.network = `unavailable: ${e instanceof Error ? e.message : String(e)}`
  }
  for (const [name, device] of Object.entries(devices)) {
    // A phone goes back to the pool after the run, so what it shows and holds
    // is copied into the session now.
    if (device.preserve) {
      await withDeadline(device.preserve(session.deviceDir(name)), 60_000, `saving ${name}`).catch(
        () => {},
      )
    }
    try {
      const library = await withDeadline(device.library(), 30_000, `${name}'s library`)
      out[name] = {
        files: library.length,
        notUploaded: library.filter((f) => !f.uploaded).length,
        logTail: (await withDeadline(device.logs(30), 30_000, `${name}'s log`)).split('\n'),
      }
    } catch (e) {
      out[name] = `unavailable: ${e instanceof Error ? e.message : String(e)}`
    }
  }
  return out
}

/** `withDeadline`'s rejection when the time ran out, as opposed to the promise's own. */
class DeadlinePassed extends Error {}

/** Rejects once `ms` pass without `promise` settling, and leaves it running. */
function withDeadline<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DeadlinePassed(`${what} took over ${ms}ms`)), ms)
  })
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer))
}

async function gitState(): Promise<{ commit: string; dirty: boolean }> {
  const commit = (await Bun.$`git -C ${REPO_ROOT} rev-parse --short HEAD`.quiet().nothrow()).stdout
    .toString()
    .trim()
  const status = (await Bun.$`git -C ${REPO_ROOT} status --porcelain`.quiet().nothrow()).stdout
    .toString()
    .trim()
  return { commit: commit || 'unknown', dirty: status.length > 0 }
}
