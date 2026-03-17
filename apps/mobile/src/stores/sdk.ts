/**
 * SDK Store - Manages Sia SDK initialization, connection, and authentication
 *
 * - AppKey: derived from the recovery phrase (mnemonic) and the indexer.
 *   The same mnemonic + indexer derives the same AppKey, making AppKeys
 *   indexer-specific. Stored securely per indexer URL to allow switching
 *   between previously authenticated indexers without re-entering the recovery phrase.
 *
 * - Per-Indexer AppKey Storage: AppKeys are stored as a map of indexerURL → AppKey.
 *   When switching to an indexer you've used before, the stored AppKey is retrieved
 *   and used for connection. When connecting to a new indexer, you must enter
 *   your mnemonic to register and derive the AppKey.
 *
 * - Mnemonic Hash: SHA-256 hash of the recovery phrase, stored in secure storage. Used
 *   to validate that a user enters the correct mnemonic when connecting to a new
 *   indexer. This ensures they derive the same AppKey and therefore access their
 *   existing account with the indexer.
 */

import { err, ok, type Result, uint8ToHex } from '@siastorage/core'
import { APP_KEY } from '@siastorage/core/config'
import { withTimeout } from '@siastorage/core/lib/timeout'
import { useConnectionState } from '@siastorage/core/stores'
import { logger } from '@siastorage/logger'
import { AppState, Platform } from 'react-native'
import type { SdkInterface } from 'react-native-sia'
import { MobileSdkAdapter } from '../adapters/sdk'
import { closeAuthBrowser, openAuthURL } from '../lib/openAuthUrl'
import { initializeUploader } from '../managers/uploader'
import { app, getMobileSdkAuth, internal } from './appService'

const APP_META_JSON = JSON.stringify({
  appID: APP_KEY,
  name: 'Sia Storage',
  description: 'Privacy-first, decentralized cloud storage',
  serviceURL: 'https://sia.storage',
  callbackUrl: 'sia://callback',
  logoUrl: 'https://app.sia.storage/icon.png',
})

let pendingApproval: {
  indexerURL: string
} | null = null

const CONNECTION_TIMEOUT_MS = 10_000

getMobileSdkAuth().setOnConnected(async () => {
  const sdk = getMobileSdkAuth().getLastSdk()
  if (sdk) {
    await setSdkWithUploader(sdk)
  }
})

/**
 * Sets SDK and manages uploader lifecycle.
 * Shuts down existing uploader when SDK changes, initializes with new SDK.
 * Exported for use by test harness.
 */
export async function setSdkWithUploader(
  sdk: SdkInterface | null,
): Promise<void> {
  const currentSdk = internal().getSdk()
  if (currentSdk && sdk) {
    try {
      await app().uploader.shutdown()
    } catch {
      // uploader may not be configured
    }
  }
  if (sdk) {
    const adapter = new MobileSdkAdapter(sdk)
    internal().setSdk(adapter)
    await initializeUploader()
  } else {
    internal().setSdk(null)
  }
}

/**
 * Initializes the SDK only if it has already been authenticated with the indexer.
 *
 * @returns SDK if connected, null if not
 */
export async function connectSdk(): Promise<SdkInterface | null> {
  try {
    const indexerURL = await app().settings.getIndexerURL()
    const keyBytes = await app().auth.getAppKey(indexerURL)
    if (!keyBytes) {
      logger.warn('sdk', 'auth_required')
      return null
    }

    const keyHex = uint8ToHex(keyBytes)
    await app().auth.builder.create(indexerURL)

    const connected = await withTimeout(
      app().auth.builder.connectWithKey(keyHex),
      CONNECTION_TIMEOUT_MS,
    )

    if (connected) {
      const sdk = getMobileSdkAuth().getLastSdk()
      if (sdk) {
        await setSdkWithUploader(sdk)
        sdk.objectEvents(undefined, 1).catch(() => {})
        return sdk
      }
    }

    logger.warn('sdk', 'auth_required')
    return null
  } catch (err) {
    logger.error('sdk', 'init_error', { error: err as Error })
    return null
  }
}

/**
 * Reconnects to the indexer only if it has already been authenticated.
 *
 * @returns true if successful, false if already reconnecting or authing or not authenticated
 */
export async function reconnectIndexer(): Promise<boolean> {
  if (app().connection.getState().isReconnecting) {
    logger.debug('sdk', 'reconnect_skipped')
    return false
  }
  app().connection.setState({ isReconnecting: true })

  logger.info('sdk', 'reconnecting')
  const isAuthing = app().connection.getState().isAuthing
  if (isAuthing) {
    logger.debug('sdk', 'auth_skipped')
    app().connection.setState({ isReconnecting: false })
    return false
  }

  try {
    const sdk = await withTimeout(connectSdk(), CONNECTION_TIMEOUT_MS)
    const connected = !!sdk

    if (connected) {
      app().connection.setState({
        isConnected: true,
        connectionError: null,
      })
    } else {
      app().connection.setState({
        isConnected: false,
        connectionError: 'Failed to connect to indexer.',
      })
    }
    return connected
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    app().connection.setState({
      isConnected: false,
      connectionError: message,
    })
    return false
  } finally {
    app().connection.setState({ isReconnecting: false })
  }
}

type AuthError = { type: 'cancelled' } | { type: 'error'; message: string }

export type AuthenticateError =
  | { type: 'cancelled' }
  | { type: 'error'; message: string }

export type AuthenticateResult = Result<
  { alreadyConnected: boolean },
  AuthenticateError
>

export type RegisterError =
  | { type: 'cancelled' }
  | { type: 'error'; message: string }
  | { type: 'mnemonicMismatch' }

export type RegisterResult = Result<void, RegisterError>

/**
 * Authenticates with an indexer during onboarding.
 *
 * If already registered (AppKey exists): connects and returns `alreadyConnected: true`.
 * If new user: runs browser auth, saves pendingApproval, and returns `alreadyConnected: false`.
 */
export async function authenticateIndexer(
  indexerURL: string,
): Promise<AuthenticateResult> {
  logger.info('sdk', 'authenticating', { indexerURL })

  const keyBytes = await app().auth.getAppKey(indexerURL)
  if (keyBytes) {
    app().connection.setState({ isAuthing: true })
    const keyHex = uint8ToHex(keyBytes)
    try {
      await app().auth.builder.create(indexerURL)
      const connected = await withTimeout(
        app().auth.builder.connectWithKey(keyHex),
        CONNECTION_TIMEOUT_MS,
      )
      if (connected) {
        logger.info('sdk', 'already_registered')
        app().settings.setIndexerURL(indexerURL)
        const sdk = getMobileSdkAuth().getLastSdk()
        if (sdk) {
          await setSdkWithUploader(sdk)
        }
        app().connection.setState({ isAuthing: false, isConnected: true })
        return ok({ alreadyConnected: true })
      }
    } catch (e) {
      app().connection.setState({ isAuthing: false })
      logger.error('sdk', 'connect_error', { error: e as Error })
      return err({
        type: 'error',
        message: e instanceof Error ? e.message : String(e),
      })
    }
    app().connection.setState({ isAuthing: false })
  }

  logger.info('sdk', 'browser_auth_start')
  app().connection.setState({ isAuthing: true })
  pendingApproval = null

  const [, authErr] = await runBrowserAuthFlow(indexerURL)

  if (authErr) {
    app().connection.setState({ isAuthing: false })
    if (authErr.type === 'cancelled') {
      return err({ type: 'cancelled' })
    }
    return err({ type: 'error', message: authErr.message })
  }

  app().connection.setState({ isAuthing: false })
  pendingApproval = { indexerURL }

  logger.info('sdk', 'browser_auth_complete')
  return ok({ alreadyConnected: false })
}

export function setSdk(sdk: SdkInterface | null) {
  if (sdk) {
    internal().setSdk(new MobileSdkAdapter(sdk))
  } else {
    internal().setSdk(null)
  }
  app().connection.setState({ isConnected: sdk !== null })
}

/**
 * Registers with the indexer using a mnemonic phrase.
 *
 * This completes the registration flow by:
 * 1. Validating mnemonic against stored hash (if exists)
 * 2. Using pending approval from authenticateIndexer (or running browser auth if none)
 * 3. Registering with mnemonic to derive AppKey
 * 4. Saving AppKey (per indexer), mnemonic hash, and indexer URL
 */
export async function registerWithIndexer(
  mnemonic: string,
  indexerURL: string,
): Promise<RegisterResult> {
  app().connection.setState({ isAuthing: true })

  const mnemonicValid = await app().auth.validateMnemonic(mnemonic)
  if (mnemonicValid === 'invalid') {
    logger.warn('sdk', 'mnemonic_hash_mismatch')
    app().connection.setState({ isAuthing: false })
    return err({ type: 'mnemonicMismatch' })
  }

  if (!pendingApproval || pendingApproval.indexerURL !== indexerURL) {
    logger.info('sdk', 'browser_auth_start')
    const [, authErr] = await runBrowserAuthFlow(indexerURL)
    if (authErr) {
      app().connection.setState({ isAuthing: false })
      pendingApproval = null
      return err(authErr)
    }
  } else {
    logger.debug('sdk', 'using_pending_approval')
  }

  try {
    logger.info('sdk', 'registering')
    const keyHex = await withTimeout(
      app().auth.builder.register(mnemonic),
      CONNECTION_TIMEOUT_MS,
    )

    await app().auth.setMnemonicHash(mnemonic)
    await app().auth.onConnected(keyHex, indexerURL)
    await app().settings.setIndexerURL(indexerURL)

    app().connection.setState({ isAuthing: false, isConnected: true })
    pendingApproval = null
    return ok(undefined)
  } catch (e) {
    app().connection.setState({ isAuthing: false })
    pendingApproval = null
    logger.error('sdk', 'register_error', { error: e as Error })
    return err({
      type: 'error',
      message: e instanceof Error ? e.message : String(e),
    })
  }
}

const BROWSER_CLOSE_GRACE_MS = 6_000

/**
 * Cancels any in-flight auth flow. Aborts the SDK's waitForApproval poll
 * via the adapter's internal AbortController and closes the auth browser.
 */
export function cancelAuth() {
  app().auth.builder.cancel()
  closeAuthBrowser()
}

/**
 * Resolves when the app returns to foreground after being backgrounded.
 * Defensive fallback for Android in case a Chrome Custom Tab dismissal
 * doesn't cause openAuthURL() to resolve on some devices.
 */
function createAppStateDismissal() {
  let resolve: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  let wasBackground = false
  const subscription = AppState.addEventListener('change', (state) => {
    if (state === 'background') {
      wasBackground = true
    } else if (state === 'active' && wasBackground) {
      resolve()
    }
  })
  return { promise, subscription }
}

/**
 * Browser auth state machine. Races three concurrent signals:
 *
 * 1. SDK approval poll — app().auth.builder.waitForApproval() (internal 5s poll loop)
 * 2. Browser dismissal — openAuthURL() resolves true (deep link) or false (manual close)
 * 3. Android AppState   — foreground after background (Chrome Custom Tab backstop)
 *
 * The adapter manages its own AbortController internally.
 * cancelAuth() / grace period timeout calls app().auth.builder.cancel() to abort.
 */
async function waitForUserApproval(
  responseUrl: string,
): Promise<Result<void, AuthError>> {
  type ApprovalOutcome = { ok: true } | { ok: false; error: Error }

  const isAndroid = Platform.OS === 'android'

  const startApprovalPoll = (): Promise<ApprovalOutcome> =>
    app()
      .auth.builder.waitForApproval()
      .then((): ApprovalOutcome => ({ ok: true }))
      .catch((e): ApprovalOutcome => ({ ok: false, error: e as Error }))

  let approvalPromise: Promise<ApprovalOutcome> | null = isAndroid
    ? null
    : startApprovalPoll()

  const browserPromise = openAuthURL(responseUrl)

  const androidDismissal = isAndroid ? createAppStateDismissal() : null

  const browserResult: { error: Error | null } = { error: null }
  const dismissalPromise = Promise.race(
    [
      browserPromise.then(
        () => {},
        (e) => {
          browserResult.error = e as Error
        },
      ),
      androidDismissal?.promise,
    ].filter(Boolean),
  )

  try {
    const raceCandidates: Promise<'dismissed' | 'approval'>[] = [
      dismissalPromise.then(() => 'dismissed' as const),
    ]
    if (approvalPromise) {
      raceCandidates.push(approvalPromise.then(() => 'approval' as const))
    }
    const winner = await Promise.race(raceCandidates)

    if (browserResult.error)
      return err({ type: 'error', message: browserResult.error.message })

    if (winner === 'approval') {
      closeAuthBrowser()
      const outcome = await approvalPromise!
      if (outcome.ok) return ok(undefined)
      if (outcome.error.name === 'AbortError') return err({ type: 'cancelled' })
      return err({ type: 'error', message: outcome.error.message })
    }

    if (!approvalPromise) {
      approvalPromise = startApprovalPoll()
    }

    const grace = await Promise.race([
      approvalPromise.then(() => 'approved' as const),
      new Promise<'timeout'>((r) =>
        setTimeout(() => r('timeout'), BROWSER_CLOSE_GRACE_MS),
      ),
    ])

    if (grace === 'approved') {
      const outcome = await approvalPromise
      if (outcome.ok) return ok(undefined)
      if (outcome.error.name === 'AbortError') return err({ type: 'cancelled' })
      return err({ type: 'error', message: outcome.error.message })
    }

    app().auth.builder.cancel()
    return err({ type: 'cancelled' })
  } finally {
    androidDismissal?.subscription.remove()
  }
}

/**
 * Runs the browser auth flow: create builder → request connection → open browser → wait for approval.
 * Returns void after approval, or an error if cancelled/failed.
 */
async function runBrowserAuthFlow(
  indexerURL: string,
): Promise<Result<void, AuthError>> {
  try {
    await app().auth.builder.create(indexerURL)
    logger.debug('sdk', 'connection_request')
    const responseUrl = await withTimeout(
      app().auth.builder.requestConnection(APP_META_JSON),
      CONNECTION_TIMEOUT_MS,
    )

    const [, approvalErr] = await waitForUserApproval(responseUrl)
    if (approvalErr) {
      if (approvalErr.type === 'cancelled') {
        logger.info('sdk', 'auth_cancelled')
      } else {
        logger.error('sdk', 'approval_error', {
          error: new Error(approvalErr.message),
        })
      }
      return err(approvalErr)
    }

    return ok(undefined)
  } catch (e) {
    logger.error('sdk', 'connection_request_error', { error: e as Error })
    return err({
      type: 'error',
      message: e instanceof Error ? e.message : String(e),
    })
  }
}

export function useIsConnected(): boolean {
  const { data } = useConnectionState()
  return data?.isConnected ?? false
}

export function useIsAuthing(): boolean {
  const { data } = useConnectionState()
  return data?.isAuthing ?? false
}

/**
 * Resets the SDK state and shuts down uploader.
 */
export async function resetSdk() {
  try {
    await app().uploader.shutdown()
  } catch {
    // uploader may not be configured
  }
  internal().setSdk(null)
  pendingApproval = null
  app().connection.setState({
    isConnected: false,
    connectionError: null,
    isAuthing: false,
    isReconnecting: false,
  })
}

export function getPendingApproval() {
  return pendingApproval
}

export function setPendingApproval(value: { indexerURL: string } | null) {
  pendingApproval = value
}
