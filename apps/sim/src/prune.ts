/**
 * Clears what finished, crashed or interrupted runs left behind: network
 * servers and CLI daemons still running, the runs' sessions, including those
 * kept for inspection, the leases on the simulators and emulators they held,
 * and the photos they added to those. A killed `sim run` cannot tear down
 * after itself, and a leftover daemon keeps its port and its CPU until
 * something stops it.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readDaemonPid } from '@siastorage/node-adapters/lock'
import { getPaths } from '@siastorage/node-adapters/paths'
import {
  allDevices,
  anyKindBusy,
  PhoneDevice,
  reapAllKinds,
  releaseAllKinds,
  stopSharedServers,
} from './devices'
import { stopNetwork } from './network'
import { isAlive, isCliDaemon } from './process'
import { defaultSessionName, Session, SIM_HOME, type SessionState } from './session'

type PruneResult = { killed: number; sessions: string[]; released: string[] }

function ownSessions(): Session[] {
  const owner = defaultSessionName()
  const sessions = []
  for (const name of existsSync(SIM_HOME) ? readdirSync(SIM_HOME) : []) {
    const file = join(SIM_HOME, name, 'session.json')
    if (!existsSync(file)) continue
    let state: SessionState
    try {
      state = JSON.parse(readFileSync(file, 'utf8')) as SessionState
    } catch {
      // A running sim rewrites this file, and a read can land mid-write.
      continue
    }
    if (state.owner === owner) sessions.push(new Session(state))
  }
  return sessions
}

function isLiveRun(session: Session): boolean {
  return session.name.startsWith('run-') && isAlive(session.state.createdBy)
}

/**
 * Hands back the phones of a session whose runner is gone, as the runner's own
 * teardown would have. That is what takes the photos the session added out of
 * a pooled simulator's library before another session gets it.
 */
async function handBackPhones(session: Session): Promise<void> {
  for (const device of allDevices(session)) {
    if (device instanceof PhoneDevice) await device.dispose().catch(() => {})
  }
}

async function stopSession(session: Session): Promise<number> {
  let killed = 0
  await stopNetwork(session)
  await handBackPhones(session)
  for (const device of Object.values(session.state.devices)) {
    const paths = getPaths(device.dir)
    const pid = readDaemonPid(paths.pidPath)
    if (pid && isCliDaemon(pid, paths.dataDir)) {
      process.kill(pid, 'SIGKILL')
      killed++
    }
  }
  return killed
}

/**
 * Removes this checkout's scenario sessions whose runner has exited, which
 * frees their pooled simulators. `all` also removes the checkout's named
 * sessions and releases what every device kind holds across sessions, such
 * as pooled simulators, so it refuses while a run is in progress unless
 * `force` is set. With `force`, a run whose runner is still alive has its
 * network and daemons stopped and its session removed like any other, and
 * the runner itself is not signalled. Other checkouts' sessions and the
 * reports in SIM_HOME/runs are left alone.
 */
export async function prune(opts: { all?: boolean; force?: boolean } = {}): Promise<PruneResult> {
  const sessions = ownSessions()
  const live = sessions.filter(isLiveRun)
  if (opts.all && !opts.force && live.length > 0) {
    throw new Error(
      `A run is in progress (${live.map((s) => s.name).join(', ')}). Wait for it, prune without --all, or pass --force if its runner was killed.`,
    )
  }
  const result: PruneResult = { killed: 0, sessions: [], released: [] }
  for (const session of sessions) {
    const abandoned = session.name.startsWith('run-') && !isLiveRun(session)
    if (!abandoned && !opts.all) continue
    result.killed += await stopSession(session)
    session.remove()
    result.sessions.push(session.name)
  }
  if (opts.all) result.released.push(...(await releaseAllKinds()))
  return result
}

/** How long a pooled phone no session holds stays booted before a sim command shuts it down. */
const PHONE_IDLE_MS = 15 * 60_000

/**
 * Shuts down this checkout's pooled phones no session has held for `idleMs`,
 * then stops Metro and Appium once no phone is on and no other sim process in
 * this checkout is starting one. A phone waiting for memory has already
 * started Metro and holds nothing from the pool yet, so the pool alone cannot
 * tell whether Metro is still needed.
 */
export async function reapIdle(idleMs = PHONE_IDLE_MS): Promise<string[]> {
  const reaped = await reapAllKinds(idleMs)
  const starting = () =>
    ownSessions().some((s) =>
      [s.state.createdBy, ...(s.state.startingPhones ?? [])].some(
        (pid) => pid !== process.pid && isAlive(pid),
      ),
    )
  await stopSharedServers(() => starting() || anyKindBusy(idleMs))
  return reaped
}

/** Whether a run in this checkout, other than this process's, is still going. */
export function otherRunInProgress(): boolean {
  return ownSessions().some((s) => isLiveRun(s) && s.state.createdBy !== process.pid)
}
