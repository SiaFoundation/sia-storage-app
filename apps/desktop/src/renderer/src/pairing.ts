/*
 * Pairing this machine with an indexer.
 *
 * The same steps mobile runs: ask the indexer for a connection, send the user
 * to approve it in a browser, wait, then register the phrase and keep the key.
 * Every call lands in the daemon, so the daemon ends up holding both, and the
 * last step tells it to wire the SDK, which it does on its own only at startup.
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

export const INVALID_PHRASE = 'Those twelve words are not a valid recovery phrase.'
export const DAEMON_DOWN = 'Sia Storage is not running. Quit and reopen the app.'
export const NOT_APPROVED = 'The connection was not approved.'
export const OTHER_ACCOUNT =
  "This Mac still holds another account's data. Sign out before switching."
export const CONNECT_FAILED = 'Signed in, but connecting failed. Try again.'
export const SIGN_IN_FAILED = 'Something went wrong. Try again.'

const FORM_MESSAGES = new Set([
  INVALID_PHRASE,
  DAEMON_DOWN,
  NOT_APPROVED,
  CONNECT_FAILED,
  OTHER_ACCOUNT,
])

/**
 * Only messages written for the form are shown as they are. A transport error
 * can quote internals such as the daemon socket path.
 */
export function safeMessage(e: unknown): string {
  const message = e instanceof Error ? e.message : ''
  return FORM_MESSAGES.has(message) ? message : SIGN_IN_FAILED
}

/**
 * Whether the SDK accepts the phrase. Twelve real words are not enough: BIP-39
 * spends the last few bits of the phrase on a checksum, so the right words in
 * the wrong order fail here and pass every check the field can make locally.
 *
 * A daemon that is not answering fails the same call, so it is asked about
 * separately rather than have an outage reported as a bad phrase.
 */
export async function checkPhrase(
  app: AppService,
  phrase: string,
): Promise<'ok' | 'invalid' | 'unreachable'> {
  try {
    await app.auth.validateRecoveryPhrase(phrase)
    return 'ok'
  } catch {
    return (await sia.daemonReachable()) ? 'invalid' : 'unreachable'
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
 * Runs the whole pairing. `onStep` reports where it is, because the approval
 * wait is minutes long and a surface with no progress reads as a hang.
 */
export async function pair(
  app: AppService,
  phrase: string,
  onStep: (step: PairingStep) => void,
): Promise<void> {
  const state = await checkPhrase(app, phrase)
  if (state === 'invalid') throw new Error(INVALID_PHRASE)
  if (state === 'unreachable') throw new Error(DAEMON_DOWN)

  // A device can hold an account hash with no key, e.g. after a failed wipe.
  // Registering a different valid phrase then would bind that account's local
  // data to another identity, so it is refused the same way mobile refuses it.
  if ((await app.auth.validateMnemonic(phrase)) === 'invalid') {
    throw new Error(OTHER_ACCOUNT)
  }

  const url = await app.settings.getIndexerURL()

  onStep('requesting')
  await app.auth.builder.create(url, APP_META_JSON)
  const approvalUrl = await app.auth.builder.requestConnection()

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

  onStep('registering')
  const keyHex = await app.auth.builder.register(phrase)
  await app.auth.setMnemonicHash(phrase)
  await app.auth.onConnected(keyHex, url)
  await app.settings.setIndexerURL(url)

  // On its own the daemon wires an SDK only at startup, so it is asked.
  const { connected } = await sia.connectDaemon()
  // The phrase is registered by now, so a false is the indexer or the network,
  // and reporting done would close the window with the daemon disconnected.
  if (!connected) throw new Error(CONNECT_FAILED)
  onStep('done')
}

export async function cancelPairing(app: AppService): Promise<void> {
  // Synchronous on the facade, a promise over the wire: without the cast a
  // daemon outage here would reject with nothing handling it.
  await (app.auth.builder.cancel() as unknown as Promise<void>).catch(() => {})
}
