/*
 * Pairing this machine with an indexer.
 *
 * Two halves, in the order the CLI runs them. First the indexer is asked for a
 * connection and the user approves it in a browser. Its answer says whether
 * the approving account already uses this app, which decides whether the next
 * screen asks for that account's recovery phrase or shows a new one. Then the
 * phrase is registered and the key kept.
 *
 * Every call lands in the daemon, so the daemon holds the approved request
 * between the two halves and ends up holding the key. The last step tells it
 * to wire the SDK, which it does on its own only at startup.
 */

import type { AppService } from '@siastorage/core/app'
import { APP_META } from '@siastorage/core/config'
import { sia } from './api'

/**
 * The identity the indexer shows on its approval page, and the same one mobile
 * and the CLI send. The `appID` in it is what the indexer keys the account on,
 * so an app that made up its own metadata would register as a different app.
 */
const APP_META_JSON = JSON.stringify(APP_META)

export type PairingStep = 'idle' | 'requesting' | 'awaiting-approval' | 'registering' | 'done'

export type PhraseCheck = 'idle' | 'ok' | 'invalid' | 'no-match' | 'unverified' | 'unreachable'

export const INVALID_PHRASE = 'Those twelve words are not a valid recovery phrase.'
export const NO_MATCH = 'That phrase is not one this account has used with Sia Storage.'
// The check runs against the approved request the daemon holds in memory, so
// after a daemon restart it fails every time and only Start over gets past it.
export const UNVERIFIED =
  'Could not check that phrase with the indexer. Try again, or choose Start over to reconnect.'
export const DAEMON_DOWN = 'Sia Storage is not running. Quit and reopen the app.'
export const REQUEST_FAILED = 'Could not reach the indexer. Check your connection and try again.'
export const NOT_APPROVED = 'The connection was not approved.'
export const OTHER_ACCOUNT =
  "This Mac still holds another account's data. Enter that account's recovery phrase."
export const REGISTER_FAILED = 'Could not finish signing in. Choose Start over to reconnect.'
export const CONNECT_FAILED = 'Signed in, but connecting failed. Try again.'
export const SIGN_IN_FAILED = 'Something went wrong. Try again.'

const FORM_MESSAGES: Record<string, true> = {
  [INVALID_PHRASE]: true,
  [DAEMON_DOWN]: true,
  [REQUEST_FAILED]: true,
  [NOT_APPROVED]: true,
  [REGISTER_FAILED]: true,
  [CONNECT_FAILED]: true,
  [OTHER_ACCOUNT]: true,
}

/**
 * Only messages written for the form are shown as they are. A transport error
 * can quote internals such as the daemon socket path.
 */
export function safeMessage(e: unknown): string {
  const message = e instanceof Error ? e.message : ''
  return Object.hasOwn(FORM_MESSAGES, message) ? message : SIGN_IN_FAILED
}

/**
 * Whether a phrase can be continued with.
 *
 * Twelve real words are not enough: BIP-39 spends the last few bits of the
 * phrase on a checksum, so the right words in the wrong order fail the SDK's
 * check and pass every check the field can make locally.
 *
 * `mustMatch` is for an account that already uses this app. Registering a
 * valid phrase the account has never used succeeds and gives it a second key
 * with no files under it, which to someone signing back in looks like their
 * files are gone, so there the phrase also has to be one the account holds a
 * key for.
 *
 * A daemon that is not answering fails the same calls, so it is asked about
 * separately rather than have an outage reported as a bad phrase.
 */
export async function checkPhrase(
  app: AppService,
  phrase: string,
  opts: { mustMatch: boolean },
): Promise<Exclude<PhraseCheck, 'idle'>> {
  try {
    await app.auth.validateRecoveryPhrase(phrase)
  } catch {
    return (await sia.daemonReachable()) ? 'invalid' : 'unreachable'
  }
  if (!opts.mustMatch) return 'ok'
  try {
    const matches = await app.auth.builder.matchesExistingAppKey(phrase)
    // `matchesExistingAppKey` resolves null when the SDK adapter has no such
    // method. The account is reconnecting, so registering a phrase nothing
    // checked could give it a second key that opens none of its files.
    if (matches === null) return 'unverified'
    return matches ? 'ok' : 'no-match'
  } catch {
    return (await sia.daemonReachable()) ? 'unverified' : 'unreachable'
  }
}

export async function generateRecoveryPhrase(app: AppService): Promise<string> {
  try {
    return await app.auth.generateRecoveryPhrase()
  } catch (e) {
    // Reaching the daemon is the one thing this needs, so an outage is named
    // rather than shown as the transport error it arrives as.
    if (!(await sia.daemonReachable())) throw new Error(DAEMON_DOWN)
    throw e
  }
}

/**
 * Asks the indexer for a connection and waits for it to be approved. `onStep`
 * reports where it is, because the approval wait is minutes long and a surface
 * with no progress reads as a hang.
 *
 * Resolves to whether the approving account already uses this app.
 */
export async function requestApproval(
  app: AppService,
  onStep: (step: PairingStep) => void,
): Promise<{ reconnecting: boolean }> {
  onStep('requesting')
  let approvalUrl: string
  try {
    const url = await app.settings.getIndexerURL()
    await app.auth.builder.create(url, APP_META_JSON)
    approvalUrl = await app.auth.builder.requestConnection()
  } catch {
    throw new Error((await sia.daemonReachable()) ? REQUEST_FAILED : DAEMON_DOWN)
  }

  onStep('awaiting-approval')
  await sia.openUrl(approvalUrl)
  try {
    // The window's service grants this call minutes rather than the transport
    // default, since it returns only when a person approves in the browser.
    await app.auth.builder.waitForApproval()
  } catch {
    // Running out of time, closing the tab and cancelling all land here, and
    // they all mean the same thing to whoever is reading the screen. The
    // cancel is for the transport-timeout arrival: it only destroyed the
    // renderer's socket, and the daemon-side wait would otherwise keep
    // polling under whatever pairing is tried next.
    await cancelPairing(app)
    throw new Error(NOT_APPROVED)
  }

  // `reconnecting()` resolves null when the SDK adapter has no such method.
  // That counts as reconnecting, so the phrase screen opens asking for the
  // account's own phrase and `checkPhrase` runs with `mustMatch`, where a new
  // account's screen would show a generated phrase to register unchecked.
  return { reconnecting: (await app.auth.builder.reconnecting()) !== false }
}

/** Registers the phrase against the approved request and connects the daemon with the key. */
export async function register(
  app: AppService,
  phrase: string,
  onStep: (step: PairingStep) => void,
): Promise<void> {
  onStep('registering')
  // A device can hold an account hash with no key, e.g. after a failed wipe.
  // Registering a different valid phrase then would bind that account's local
  // data to another identity, so it is refused the same way mobile refuses it.
  if ((await app.auth.validateMnemonic(phrase)) === 'invalid') {
    throw new Error(OTHER_ACCOUNT)
  }

  const url = await app.settings.getIndexerURL()
  let keyHex: string
  try {
    keyHex = await app.auth.builder.register(phrase)
  } catch {
    // The daemon holds the approved request in memory, so after a daemon
    // restart this call fails on every retry and only a new request works.
    throw new Error((await sia.daemonReachable()) ? REGISTER_FAILED : DAEMON_DOWN)
  }
  await app.auth.setMnemonicHash(phrase)
  await app.auth.onConnected(keyHex, url)
  await app.settings.setIndexerURL(url)
  // The flag mobile and the CLI set on their own sign-ins. `sia connect`
  // reads it to warn before overwriting an account, and the daemon's state
  // is shared, so a desktop sign-in has to count.
  await app.settings.setHasOnboarded(true)

  // On its own the daemon wires an SDK only at startup, so it is asked.
  const { connected } = await sia.connectDaemon()
  // The phrase is registered by now, so a false is the indexer or the network,
  // and reporting done would move on with the daemon disconnected.
  if (!connected) throw new Error(CONNECT_FAILED)
  onStep('done')
}

export async function cancelPairing(app: AppService): Promise<void> {
  // Synchronous on the facade, a promise over the wire: without the cast a
  // daemon outage here would reject with nothing handling it.
  await (app.auth.builder.cancel() as unknown as Promise<void>).catch(() => {})
}
