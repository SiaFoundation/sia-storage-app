/**
 * Live mode: phones on the real Sia network, signed into a test account, for
 * a measurement the mock network cannot give, such as how long real hosts
 * take to answer. The session's mock network still runs, as the relay sim
 * drives each phone through, but the app talks to the real indexer.
 *
 * The account lives in the checkout's `.env.sim-live`, as `SIM_LIVE_INDEXER_URL`
 * and `SIM_LIVE_RECOVERY_PHRASE`. Not `.env`, which bun loads into every
 * process it starts from the repo root, tests and Metro included.
 *
 * Signing in from a recovery phrase needs someone to approve the app in a
 * browser, which a test cannot do. `bun sim live login` does that once on this
 * Mac and writes the app key it registers to `SIM_LIVE_APP_KEY`. A phone then
 * connects with that key, which needs no approval, the way the app reconnects
 * on every launch.
 */
import { chmodSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { APP_META } from '@siastorage/core/config'
import type { NodeSdkAuthResult } from '@siastorage/node-adapters/auth'
import { REPO_ROOT, SIM_HOME, Session, type SessionState } from './session'

export type LiveAccount = { indexerUrl: string; appKeyHex: string }

type Sdk = NonNullable<ReturnType<NodeSdkAuthResult['getLastSdk']>>

/**
 * Loaded on first use, since every sim command imports this module through
 * the phone device, and only live sessions need the real SDK's native binary.
 */
async function sdkAuth(): Promise<NodeSdkAuthResult> {
  const { createNodeSdkAuthAdapter } = await import('@siastorage/node-adapters/auth')
  return createNodeSdkAuthAdapter()
}

const ENV_FILE = join(REPO_ROOT, '.env.sim-live')

/** The `KEY=value` lines of an env file, with surrounding quotes taken off. */
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line)
    if (!m) continue
    let value = m[2]
    if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]) {
      value = value.slice(1, -1)
    }
    out[m[1]] = value
  }
  return out
}

/** `text` with `key` set to `value`, replacing its line or adding one at the end. */
export function setEnvValue(text: string, key: string, value: string): string {
  const line = `${key}="${value}"`
  const pattern = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=.*$`, 'm')
  if (pattern.test(text)) return text.replace(pattern, line)
  return `${text.replace(/\n*$/, '')}\n${line}\n`
}

function envValue(key: string): string | undefined {
  return existsSync(ENV_FILE) ? parseEnv(readFileSync(ENV_FILE, 'utf8'))[key] : undefined
}

function required(key: string): string {
  const value = envValue(key)
  if (!value) {
    throw new Error(
      `Live mode needs ${key} in ${ENV_FILE}. It names the real-network test account, never a personal one, since every live session deletes all of its files.`,
    )
  }
  return value
}

/** The account a live phone signs into, or an error saying what to set up. */
export function liveAccount(): LiveAccount {
  const indexerUrl = required('SIM_LIVE_INDEXER_URL')
  const appKeyHex = envValue('SIM_LIVE_APP_KEY')
  if (!appKeyHex) {
    throw new Error(
      'Live mode needs the test account approved for this app once. Run `bun sim live login`.',
    )
  }
  return { indexerUrl, appKeyHex }
}

/**
 * Approves the app for the test account and stores the app key the phrase
 * registers. Someone signed into the test account in a browser has to open
 * the approval page, which `onApprovalUrl` is given before the wait.
 */
export async function login(onApprovalUrl: (url: string) => void): Promise<void> {
  const indexerUrl = required('SIM_LIVE_INDEXER_URL')
  const phrase = required('SIM_LIVE_RECOVERY_PHRASE')
  const { adapters } = await sdkAuth()
  adapters.validateRecoveryPhrase(phrase)
  await adapters.createBuilder(indexerUrl, JSON.stringify(APP_META))
  const approvalUrl = await adapters.requestConnection()
  onApprovalUrl(approvalUrl)
  await adapters.waitForApproval()
  const appKeyHex = await adapters.register(phrase)
  const text = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, 'utf8') : ''
  writeFileSync(ENV_FILE, setEnvValue(text, 'SIM_LIVE_APP_KEY', appKeyHex), { mode: 0o600 })
  // The mode above applies only to a file it creates. The key opens the
  // account, so other users on the Mac must not read it either way.
  chmodSync(ENV_FILE, 0o600)
}

/** The SDK on the test account, or null when the account refuses the stored key. */
async function connect(): Promise<Sdk | null> {
  const { indexerUrl, appKeyHex } = liveAccount()
  const { adapters, getLastSdk } = await sdkAuth()
  await adapters.createBuilder(indexerUrl, JSON.stringify(APP_META))
  return (await adapters.connectWithKey(appKeyHex)) ? getLastSdk() : null
}

/** Whether the stored app key still connects, without changing anything. */
export async function checkLogin(): Promise<boolean> {
  return (await connect()) !== null
}

const EVENTS_PAGE = 500

/**
 * The objects still on the account. An object is there when its last event
 * is not a delete, so the whole event history is read, a page at a time.
 */
export async function objectsOnAccount(sdk: Pick<Sdk, 'objectEvents'>): Promise<Set<string>> {
  const remaining = new Set<string>()
  let cursor: { id: string; after: Date } | undefined
  for (;;) {
    const events = await sdk.objectEvents(cursor, EVENTS_PAGE)
    for (const e of events) {
      if (e.deleted) remaining.delete(e.id)
      else remaining.add(e.id)
    }
    const last = events.at(-1)
    if (!last || events.length < EVENTS_PAGE) return remaining
    cursor = { id: last.id, after: last.updatedAt }
  }
}

/**
 * Deletes every file on the test account and unpins their slabs, so a live
 * session starts from an empty account the way a mock network does, whatever
 * earlier runs left. Returns how many objects it deleted.
 */
export async function wipeAccount(): Promise<number> {
  const sdk = await connect()
  if (!sdk) throw new Error('The test account refused the app key. Run `bun sim live login`.')
  const remaining = await objectsOnAccount(sdk)
  for (const id of remaining) await sdk.deleteObject(id)
  // Unconditional: a wipe that deleted the last objects and stopped before
  // pruning leaves their slabs pinned with no object left to find them by.
  await sdk.pruneSlabs()
  return remaining.size
}

/** Whether `device` in the session `state` describes still has its app running. */
type PhoneRunning = (state: SessionState, device: string) => Promise<boolean>

async function appRunning(state: SessionState, device: string): Promise<boolean> {
  // Loaded here because the phone devices import this module.
  const { openDevice } = await import('./devices')
  return openDevice(new Session(state), device)
    .isRunning()
    .catch(() => false)
}

/**
 * Another session whose phones are on the test account right now: its mock
 * network answers, or one of its phones still runs the app, which talks to
 * the real indexer whether or not the relay is up. Two at once would each
 * sync down the other's uploads, and one's wipe would delete the other's
 * files mid-run.
 */
export async function otherLiveSession(
  name: string,
  phoneRunning: PhoneRunning = appRunning,
): Promise<string | null> {
  for (const dir of existsSync(SIM_HOME) ? readdirSync(SIM_HOME) : []) {
    const file = join(SIM_HOME, dir, 'session.json')
    if (dir === name || !existsSync(file)) continue
    let state: SessionState
    try {
      state = JSON.parse(readFileSync(file, 'utf8')) as SessionState
    } catch {
      // A running sim rewrites this file, and a read can land mid-write.
      continue
    }
    if (!state.live) continue
    const answered = state.networkUrl
      ? await fetch(`${state.networkUrl}/control/health`, {
          signal: AbortSignal.timeout(2000),
        }).then(
          (r) => r.ok,
          () => false,
        )
      : false
    if (answered) return state.name
    for (const [device, record] of Object.entries(state.devices)) {
      if (record.target && (await phoneRunning(state, device))) return state.name
    }
  }
  return null
}

/** Throws when another session has phones on the test account, naming it. */
export async function refuseOtherLiveSession(name: string): Promise<void> {
  const other = await otherLiveSession(name)
  if (other) {
    throw new Error(
      `Session ${other} has phones on the test account. Live sessions run one at a time, so stop it first with \`bun sim --session ${other} down\`.`,
    )
  }
}
