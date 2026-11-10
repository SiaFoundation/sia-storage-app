/**
 * Who may use a desktop build context's installed app on this Mac. A context,
 * `test` for sim, installs one app with one Finder folder per Mac, so one
 * session drives it at a time, and installing it again replaces the app under
 * whoever is driving it. A Windows VM's desktop session is leased the same
 * way under the context `windows-<vm>`, since the app allows one running copy
 * there. Three kinds of holder share it:
 *
 * - A session with a desktop device, named in `desktop-<context>.lease` for as
 *   long as the session exists. The file holds the bare session name, which is
 *   what checkouts on older commits read.
 * - A `sim run` that has started a desktop scenario. Each scenario has a
 *   session of its own and frees the lease when it ends, so the run also holds
 *   the build until it finishes, or an install or another checkout's session
 *   would take it between two scenarios.
 * - An install by `desktop:package` or `desktop:dev`, which waits for the
 *   other two and makes a session that starts meanwhile refuse.
 *
 * The last two are holds (machine.ts) in `desktop-<context>.hold`. All three
 * change only under `desktop-<context>.lock`.
 *
 * The desktop app's packaging imports this file as
 * `@siastorage/sim/desktop-lock`, so it imports nothing beyond session.ts and
 * machine.ts.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { withFileLock } from './lock'
import {
  describeHolder,
  type Holder,
  holderRecord,
  readHold,
  releaseHold,
  tryHold,
  waitInLine,
} from './machine'
import { isAlive } from './process'
import { defaultSessionName, REPO_ROOT, SIM_HOME, Session } from './session'

export type DesktopHold = Holder & { kind: 'run' | 'install'; run?: string }

/** Where an installed build came from, written when an install finishes. */
export type InstalledBuild = {
  checkout: string
  commit: string
  /** Whether tracked files had changes the commit does not have. */
  dirty: boolean
  at: string
}

const path = (context: string, ext: 'lease' | 'lock' | 'hold' | 'installed') =>
  join(SIM_HOME, `desktop-${context}.${ext}`)

/**
 * The session holding the build, if that session still exists. A scenario
 * run's session outlives a runner that was killed, until `prune` removes it,
 * so a `run-` session whose runner has exited holds nothing.
 */
export function leaseHolder(context: string): string | null {
  const file = path(context, 'lease')
  if (!existsSync(file)) return null
  const name = readFileSync(file, 'utf8').trim()
  const session = loadSession(name)
  if (!session) return null
  if (name.startsWith('run-') && !isAlive(session.state.createdBy)) return null
  return name
}

function loadSession(name: string): Session | null {
  try {
    return Session.load(name)
  } catch {
    return null
  }
}

/** A lease holder as a waiter prints it. */
export function describeSession(name: string): string {
  const owner = loadSession(name)?.state.owner
  return owner ? `session ${name} from checkout ${owner}` : `session ${name}`
}

/** The run or install holding the build, if its process is still alive. */
export function desktopHold(context: string): DesktopHold | null {
  return readHold<DesktopHold>(path(context, 'hold'))
}

/** The run id in a scenario session's name, `run-<run id>-<index>`. */
function runOf(session: string): string | null {
  return /^run-(.+)-\d+$/.exec(session)?.[1] ?? null
}

/**
 * Leases the build to `session`, waiting while another session or run holds
 * it, and refusing while it is being installed, since the app that install
 * leaves is another checkout's build. A scenario session's run takes the run
 * hold here, at its first desktop scenario.
 */
export async function takeLease(
  context: string,
  appName: string,
  session: string,
  opts: { intervalMs?: number; log?: (line: string) => void; waitsFor?: string } = {},
): Promise<void> {
  const run = runOf(session)
  await waitInLine({
    waitsFor: opts.waitsFor ?? `the ${appName} app`,
    what: `a desktop device in session ${session}`,
    timeoutMs: 30 * 60_000,
    intervalMs: opts.intervalMs ?? 5000,
    log: opts.log,
    attempt: () =>
      withFileLock(path(context, 'lock'), async () => {
        const hold = desktopHold(context)
        if (hold?.kind === 'install') {
          throw new Error(
            `${appName} is being installed by ${describeHolder(hold)}. Start the device again once that finishes. It will then run that checkout's build.`,
          )
        }
        if (hold && (!run || hold.run !== run))
          return { blockedBy: `held by ${describeHolder(hold)}` }
        const holder = leaseHolder(context)
        if (holder && holder !== session) {
          return { blockedBy: `held by ${describeSession(holder)}` }
        }
        // A hold file that is empty for a few seconds is one a holder is still
        // writing, or one a holder killed mid-write left, so the run waits it out.
        if (
          run &&
          !hold &&
          !tryHold(path(context, 'hold'), { ...holderRecord(`sim run ${run}`), kind: 'run', run })
        ) {
          return { blockedBy: 'another holder is starting' }
        }
        mkdirSync(SIM_HOME, { recursive: true })
        writeFileSync(path(context, 'lease'), session)
        return { got: undefined }
      }),
  })
}

export function releaseLease(context: string): void {
  rmSync(path(context, 'lease'), { force: true })
}

/** Frees every build this process's run `runId` holds. */
export function releaseRunHolds(runId: string): void {
  if (!existsSync(SIM_HOME)) return
  for (const file of readdirSync(SIM_HOME)) {
    if (!/^desktop-.+\.hold$/.test(file)) continue
    const hold = readHold<DesktopHold>(join(SIM_HOME, file))
    if (hold?.kind === 'run' && hold.run === runId) releaseHold(join(SIM_HOME, file))
  }
}

/**
 * Runs `install`, which replaces the context's installed app, once no other
 * checkout's session and no run or other install holds the build, and holds it
 * until `install` returns. A session in this checkout does not hold it up,
 * since repackaging under one's own device is the desktop development loop.
 */
export async function withDesktopInstall<T>(
  context: string,
  appName: string,
  install: () => Promise<T>,
  opts: { intervalMs?: number; log?: (line: string) => void } = {},
): Promise<T> {
  const log = opts.log ?? ((line: string) => console.error(line))
  const record: DesktopHold = { ...holderRecord(`install ${appName}`), kind: 'install' }
  const checkout = defaultSessionName()
  // Read before the wait, since the build being installed already exists and
  // the checkout can move to another commit while this waits its turn.
  const built = installedHere()
  const own = await waitInLine({
    waitsFor: `${appName} to be free to install`,
    what: record.what,
    timeoutMs: 60 * 60_000,
    intervalMs: opts.intervalMs ?? 5000,
    log,
    attempt: () =>
      withFileLock(path(context, 'lock'), async () => {
        const hold = desktopHold(context)
        if (hold) return { blockedBy: `held by ${describeHolder(hold)}` }
        const holder = leaseHolder(context)
        if (holder && loadSession(holder)?.state.owner !== checkout) {
          return { blockedBy: `held by ${describeSession(holder)}` }
        }
        if (!tryHold(path(context, 'hold'), record))
          return { blockedBy: 'another install is starting' }
        return { got: holder }
      }),
  })
  if (own) {
    log(
      `Session ${own} in this checkout has a desktop device on ${appName}, which the install quits. Start it again with \`bun sim device start\`.`,
    )
  }
  try {
    const result = await install()
    writeFileSync(
      path(context, 'installed'),
      JSON.stringify({ ...built, at: new Date().toISOString() }),
    )
    return result
  } finally {
    releaseHold(path(context, 'hold'))
  }
}

function installedHere(): InstalledBuild {
  const git = (args: string[]) =>
    Bun.spawnSync(['git', ...args], { cwd: REPO_ROOT })
      .stdout.toString()
      .trim()
  return {
    checkout: defaultSessionName(),
    commit: git(['rev-parse', 'HEAD']),
    dirty: git(['status', '--porcelain', '--untracked-files=no']) !== '',
    at: new Date().toISOString(),
  }
}

/** Where the context's installed app was last installed from, when an install recorded it. */
export function installedBuild(context: string): InstalledBuild | null {
  try {
    return JSON.parse(readFileSync(path(context, 'installed'), 'utf8')) as InstalledBuild
  } catch {
    return null
  }
}
