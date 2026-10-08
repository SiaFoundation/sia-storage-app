/**
 * A session is one mock network plus the devices attached to it, recorded in a
 * directory so that separate `sim` invocations, from an agent or a person, act
 * on the same running processes.
 *
 * Sessions live under /tmp/sia-sim rather than the OS temp dir. A CLI device
 * listens on `<device dir>/daemon.sock`, and macOS caps a socket path at 104
 * bytes, which the longer /var/folders temp path can exceed.
 *
 * Each checkout gets its own default session, named from its directory, so
 * agents in different worktrees never share a network by accident.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { withFileLock } from './lock'

export const REPO_ROOT = resolve(import.meta.dir, '../../..')
export const SIM_HOME = process.env.SIM_HOME ?? '/tmp/sia-sim'

export type DeviceKind = 'cli' | 'ios' | 'android' | 'desktop'

/** A device kind that runs the mobile app. */
export type PhoneKind = 'ios' | 'android'

export type DeviceRecord = {
  kind: DeviceKind
  dir: string
  /** For a phone, the simulator udid or emulator serial it runs on. */
  target?: string
  /**
   * For a phone, set once the leased device has been wiped and the app
   * installed. A first start that fails before then leaves it unset, so the
   * next start wipes again rather than launching whatever the device held.
   */
  prepared?: boolean
  /**
   * For an iOS phone, the host ports its WebDriverAgent and screen stream
   * listen on. Every simulator shares the Mac's loopback, and a second
   * session on the default port attaches to the first simulator's agent.
   */
  uiPorts?: { wda: number; mjpeg: number }
  /**
   * For a phone, the file names of the photos it added to its simulator's or
   * emulator's library. The library outlives the session, since the pool
   * hands the same device to the next one, so they are taken out again when
   * the phone is handed back.
   */
  photos?: string[]
  /** For a desktop device, the port its app serves the Chrome DevTools Protocol on. */
  debugPort?: number
  /**
   * For a desktop device, set when it starts with no account. Sim then leaves
   * sign-in to the app's own window, which is the only way those screens and
   * the setup after them are ever shown.
   */
  signedOut?: boolean
}

export type SessionState = {
  name: string
  /** The checkout that created it. */
  owner: string
  /** The process that created it. */
  createdBy: number
  dir: string
  fastTimers: boolean
  /** The session's mock network while it runs. */
  networkUrl?: string
  /**
   * The sim processes starting a phone in this session, once per phone. A
   * resumed `up` or a `device add` is not the process that created the
   * session, and `prune` reads this to leave Metro running for them.
   */
  startingPhones?: number[]
  devices: Record<string, DeviceRecord>
}

export function defaultSessionName(): string {
  // A worktree checkout sits at <worktrees>/<name>/sia-storage-app, so the
  // parent directory's name is the one that tells checkouts apart.
  const leaf = basename(REPO_ROOT)
  const parent = basename(dirname(REPO_ROOT))
  return (leaf === 'sia-storage-app' ? parent : leaf).replace(/[^a-zA-Z0-9-]/g, '-')
}

/**
 * A session's directory. The name is checked here because `down --clean`
 * deletes this directory, and a name such as `..` would make it SIM_HOME's
 * parent.
 */
export function sessionDir(name: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(name)) {
    throw new Error(`Session names are letters, digits and dashes: ${name}`)
  }
  return join(SIM_HOME, name)
}

/**
 * What sim keeps in SIM_HOME beside the sessions: run reports in `runs`, each
 * checkout's phone pools, Metro and Appium, and the Appium drivers. A session
 * named like one of those would share its directory, and one named `run-`
 * would be pruned as a scenario run's leftover.
 */
const RESERVED_NAME = /^(runs$|run-|metro-|appium-|ios-pool-|android-pool-)/

/** Refuses a name `up` would create a session under when sim uses it for something else. */
export function checkNewSessionName(name: string): void {
  sessionDir(name)
  if (RESERVED_NAME.test(name)) {
    throw new Error(
      `Session names cannot be runs or start with run-, metro-, appium-, ios-pool- or android-pool-, which sim uses for its own directories: ${name}`,
    )
  }
}

export class Session {
  constructor(readonly state: SessionState) {}

  static load(name: string): Session | null {
    const file = join(sessionDir(name), 'session.json')
    if (!existsSync(file)) return null
    return new Session(JSON.parse(readFileSync(file, 'utf8')) as SessionState)
  }

  static create(name: string, opts: { fastTimers: boolean }): Session {
    const dir = sessionDir(name)
    mkdirSync(dir, { recursive: true })
    const session = new Session({
      name,
      owner: defaultSessionName(),
      createdBy: process.pid,
      dir,
      fastTimers: opts.fastTimers,
      devices: {},
    })
    writeState(session.state)
    return session
  }

  get name(): string {
    return this.state.name
  }

  get dir(): string {
    return this.state.dir
  }

  /**
   * Changes the recorded state and saves it. Several `sim` commands can act on
   * one session at once, such as two `device add`s, so the change is applied
   * to the file as it is now, read under the session's lock, rather than to
   * this command's copy, which would drop whatever another saved since.
   */
  async update(change: (state: SessionState) => void): Promise<void> {
    await withFileLock(join(this.state.dir, 'session.lock'), async () => {
      const fresh = JSON.parse(
        readFileSync(join(this.state.dir, 'session.json'), 'utf8'),
      ) as SessionState
      change(fresh)
      writeState(fresh)
      for (const key of Object.keys(this.state)) delete (this.state as Record<string, unknown>)[key]
      Object.assign(this.state, fresh)
    })
  }

  deviceDir(device: string): string {
    return join(this.state.dir, 'devices', device)
  }

  networkUrl(): string {
    if (!this.state.networkUrl) throw new Error(`Session ${this.name} has no network running`)
    return this.state.networkUrl
  }

  remove(): void {
    rmSync(this.state.dir, { recursive: true, force: true })
  }
}

/** Writes session.json through a rename, so a command reading it never sees half a write. */
function writeState(state: SessionState): void {
  const file = join(state.dir, 'session.json')
  writeFileSync(`${file}.tmp`, `${JSON.stringify(state, null, 2)}\n`)
  renameSync(`${file}.tmp`, file)
}

export function requireSession(name: string): Session {
  const session = Session.load(name)
  if (!session) {
    throw new Error(`No sim session "${name}". Start one with: bun sim up`)
  }
  return session
}
