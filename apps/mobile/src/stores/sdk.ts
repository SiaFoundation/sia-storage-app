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

import { err, hexToUint8, ok, type Result } from '@siastorage/core'
import { APP_KEY } from '@siastorage/core/config'
import { withTimeout } from '@siastorage/core/lib/timeout'
import { logger } from '@siastorage/logger'
import { AppState, Platform } from 'react-native'
import {
  type AppKey,
  Builder,
  type BuilderInterface,
  type PinnedObjectInterface,
  type SdkInterface,
} from 'react-native-sia'
import { create } from 'zustand'
import { closeAuthBrowser, openAuthURL } from '../lib/openAuthUrl'
import { createGetterAndSelector } from '../lib/selectors'
import { getUploadManager } from '../managers/uploader'
import { getAppKey, getAppKeyForIndexer, setAppKeyForIndexer } from './appKey'
import { setMnemonicHash, validateMnemonic } from './mnemonic'
import { getIndexerURL, setIndexerURL } from './settings'

export type SdkState = {
  sdk: SdkInterface | null
  isConnected: boolean
  connectionError: string | null
  isAuthing: boolean
  isReconnecting: boolean
  /**
   * Stores pendingApproval from authenticateIndexer, used by registerWithIndexer.
   * This allows browser auth to happen once on the Choose Indexer screen,
   * and the Recovery Phrase screen can reuse the approval.
   * Cleared after registration completes or on error.
   */
  pendingApproval: {
    indexerURL: string
    builder: BuilderInterface
  } | null
}

export const useSdkStore = create<SdkState>(() => {
  return {
    sdk: null,
    isConnected: false,
    connectionError: null,
    isAuthing: false,
    isReconnecting: false,
    pendingApproval: null,
  }
})

const { getState, setState } = useSdkStore

const CONNECTION_TIMEOUT_MS = 10_000

/**
 * Sets SDK and manages uploader lifecycle.
 * Shuts down existing uploader when SDK changes, initializes with new SDK.
 * Exported for use by test harness.
 */
export async function setSdkWithUploader(
  sdk: SdkInterface | null,
): Promise<void> {
  const currentSdk = getState().sdk
  if (currentSdk && currentSdk !== sdk) {
    await getUploadManager().shutdown()
  }
  setState({ sdk })
  if (sdk) {
    const indexerURL = await getIndexerURL()
    getUploadManager().initialize(sdk, indexerURL)
  }
}

/**
 * Initializes the SDK only if it has already been authenticated with the indexer.
 *
 * @returns SDK if connected, null if not
 */
export async function connectSdk(): Promise<SdkInterface | null> {
  try {
    const indexerURL = await getIndexerURL()
    const appKey = await getAppKey()
    const builder = new Builder(indexerURL)

    const [sdk, err] = await builderConnected(builder, appKey)
    if (err) {
      logger.error('sdk', 'connect_error', { error: err as Error })
      return null
    }

    if (sdk) {
      await setSdkWithUploader(sdk)
      // Warm up the HTTP connection pool so the first real request doesn't timeout.
      sdk.objectEvents(undefined, 1).catch(() => {})
      return sdk
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
  if (getState().isReconnecting) {
    logger.debug('sdk', 'reconnect_skipped')
    return false
  }
  setState({ isReconnecting: true })

  logger.info('sdk', 'reconnecting')
  const isAuthing = getState().isAuthing
  if (isAuthing) {
    logger.debug('sdk', 'auth_skipped')
    setState({ isReconnecting: false })
    return false
  }

  try {
    const sdk = await withTimeout(connectSdk(), CONNECTION_TIMEOUT_MS)
    const connected = !!sdk

    if (connected) {
      setState({
        isConnected: true,
        connectionError: null,
      })
    } else {
      setState({
        isConnected: false,
        connectionError: 'Failed to connect to indexer.',
      })
    }
    return connected
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    setState({
      isConnected: false,
      connectionError: message,
    })
    return false
  } finally {
    setState({ isReconnecting: false })
  }
}

// Used internally for browser auth flow results.
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

  // Check if we have an AppKey for this indexer (returning user).
  const appKey = await getAppKeyForIndexer(indexerURL)
  if (appKey) {
    setState({ isAuthing: true })
    const builder = new Builder(indexerURL)
    const [sdk, connectedErr] = await builderConnected(builder, appKey)
    if (connectedErr) {
      setState({ isAuthing: false })
      logger.error('sdk', 'connect_error', { error: connectedErr as Error })
      return err({ type: 'error', message: connectedErr.message })
    }
    if (sdk) {
      logger.info('sdk', 'already_registered')
      setIndexerURL(indexerURL)
      await setSdkWithUploader(sdk)
      setState({ isAuthing: false, isConnected: true })
      return ok({ alreadyConnected: true })
    }
    setState({ isAuthing: false })
  }

  // New user - run browser auth and save approved builder for registerWithIndexer.
  logger.info('sdk', 'browser_auth_start')
  setState({ isAuthing: true, pendingApproval: null })

  const builder = new Builder(indexerURL)
  const [approvedBuilder, authErr] = await runBrowserAuthFlow(builder)

  if (authErr) {
    setState({ isAuthing: false })
    if (authErr.type === 'cancelled') {
      return err({ type: 'cancelled' })
    }
    return err({ type: 'error', message: authErr.message })
  }

  // Save approved builder for registerWithIndexer.
  setState({
    isAuthing: false,
    pendingApproval: approvedBuilder
      ? { indexerURL, builder: approvedBuilder }
      : null,
  })

  logger.info('sdk', 'browser_auth_complete')
  return ok({ alreadyConnected: false })
}

export function setIsConnected(connected: boolean) {
  return useSdkStore.setState({ isConnected: connected })
}

export function setSdk(sdk: SdkInterface | null) {
  return useSdkStore.setState({ sdk, isConnected: sdk !== null })
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
  setState({ isAuthing: true })

  // Validate mnemonic against stored hash if one exists.
  const mnemonicValid = await validateMnemonic(mnemonic)
  if (mnemonicValid === 'invalid') {
    logger.warn('sdk', 'mnemonic_hash_mismatch')
    // Keep pendingApproval so user can fix mnemonic and retry.
    setState({ isAuthing: false })
    return err({ type: 'mnemonicMismatch' })
  }

  // Use pending approval from authenticateIndexer if available.
  const { pendingApproval } = getState()
  let approvedBuilder: BuilderInterface | null = null

  if (pendingApproval && pendingApproval.indexerURL === indexerURL) {
    logger.debug('sdk', 'using_pending_approval')
    approvedBuilder = pendingApproval.builder
  } else {
    // No pending approval - run browser auth (fallback for edge cases).
    logger.info('sdk', 'browser_auth_start')
    const builder = new Builder(indexerURL)
    const [result, authErr] = await runBrowserAuthFlow(builder)
    if (authErr) {
      setState({ isAuthing: false, pendingApproval: null })
      return err(authErr)
    }
    approvedBuilder = result
  }

  if (!approvedBuilder) {
    setState({ isAuthing: false, pendingApproval: null })
    return err({ type: 'error', message: 'Unexpected null builder' })
  }

  // Register with mnemonic.
  const [sdk, registerErr] = await builderRegister(approvedBuilder, mnemonic)
  if (registerErr) {
    setState({ isAuthing: false, pendingApproval: null })
    logger.error('sdk', 'register_error', { error: registerErr as Error })
    return err({ type: 'error', message: registerErr.message })
  }

  // Save credentials for future sessions.
  await setAppKeyForIndexer(indexerURL, sdk.appKey())
  await setMnemonicHash(mnemonic)
  await setIndexerURL(indexerURL)

  await setSdkWithUploader(sdk)
  setState({ isAuthing: false, isConnected: true, pendingApproval: null })
  return ok(undefined)
}

/**
 * Attempts to connect using an existing AppKey.
 * Returns SDK if already registered, null otherwise.
 */
async function builderConnected(
  builder: Builder,
  appKey: AppKey,
): Promise<Result<SdkInterface | null>> {
  try {
    logger.debug('sdk', 'builder_connected_attempt')
    const sdk = await withTimeout(
      builder.connected(appKey),
      CONNECTION_TIMEOUT_MS,
    )
    return ok(sdk ?? null)
  } catch (e) {
    return err(e as Error)
  }
}

/**
 * Requests app connection from the indexer.
 */
async function builderRequestConnection(
  builder: Builder,
): Promise<Result<BuilderInterface>> {
  try {
    logger.debug('sdk', 'connection_request')
    const result = await withTimeout(
      builder.requestConnection({
        id: hexToUint8(APP_KEY).buffer,
        name: 'Sia Storage',
        description: 'Privacy-first, decentralized cloud storage',
        serviceUrl: 'https://sia.storage',
        callbackUrl: 'sia://callback',
        logoUrl: 'https://app.sia.storage/icon.png',
      }),
      CONNECTION_TIMEOUT_MS,
    )
    return ok(result)
  } catch (e) {
    return err(e as Error)
  }
}

// Slightly longer than the SDK's 5s poll interval so one full cycle can complete.
const BROWSER_CLOSE_GRACE_MS = 6_000

let authAbortController: AbortController | null = null

/**
 * Cancels any in-flight auth flow. Aborts the SDK's waitForApproval poll
 * via AbortSignal and closes the auth browser.
 */
export function cancelAuth() {
  authAbortController?.abort()
  authAbortController = null
  closeAuthBrowser()
}

/**
 * Registers the app with a mnemonic, deriving the AppKey.
 */
async function builderRegister(
  builder: BuilderInterface,
  mnemonic: string,
): Promise<Result<SdkInterface>> {
  try {
    logger.info('sdk', 'registering')
    const result = await withTimeout(
      builder.register(mnemonic),
      CONNECTION_TIMEOUT_MS,
    )
    return ok(result)
  } catch (e) {
    return err(e as Error)
  }
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
 * 1. SDK approval poll — builder.waitForApproval() (internal 5s poll loop)
 * 2. Browser dismissal — openAuthURL() resolves true (deep link) or false (manual close)
 * 3. Android AppState   — foreground after background (Chrome Custom Tab backstop)
 *
 * The SDK's waitForApproval() accepts an AbortSignal, which we use to cancel
 * the poll cleanly when the user navigates away or a grace period expires.
 *
 * Signal handling:
 * - Approval poll resolves → close browser, return result
 * - Browser dismissed       → wait for poll up to 6s, then cancel
 * - cancelAuth()            → abort poll immediately, return cancelled
 */
async function waitForUserApproval(
  builder: BuilderInterface,
): Promise<Result<BuilderInterface, AuthError>> {
  const responseUrl = builder.responseUrl()

  const abortController = new AbortController()
  authAbortController = abortController
  const { signal } = abortController

  type ApprovalOutcome =
    | { ok: true; result: BuilderInterface }
    | { ok: false; error: Error }

  const startApprovalPoll = (): Promise<ApprovalOutcome> =>
    builder
      .waitForApproval({ signal })
      .then((result): ApprovalOutcome => ({ ok: true, result }))
      .catch((e): ApprovalOutcome => ({ ok: false, error: e as Error }))

  const isAndroid = Platform.OS === 'android'

  // iOS: start polling immediately (app stays in foreground).
  // Android: defer polling until user returns — background network is unreliable.
  let approvalPromise: Promise<ApprovalOutcome> | null = isAndroid
    ? null
    : startApprovalPoll()

  const browserPromise = openAuthURL(responseUrl)

  // Android backstop: detect foreground via AppState in case Chrome Custom
  // Tab dismissal doesn't cause openAuthURL to resolve on some devices.
  const androidDismissal = isAndroid ? createAppStateDismissal() : null

  // Dismissal = browser closed (deep link or manual) OR Android AppState foreground.
  // Swallow any rejection from openAuthURL so dismissalPromise never rejects.
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
    // Race: on iOS the approval poll can win; on Android only dismissal wins
    // because the poll is deferred until the browser is dismissed.
    const raceCandidates: Promise<'dismissed' | 'approval'>[] = [
      dismissalPromise.then(() => 'dismissed' as const),
    ]
    if (approvalPromise) {
      raceCandidates.push(approvalPromise.then(() => 'approval' as const))
    }
    const winner = await Promise.race(raceCandidates)

    if (signal.aborted) return err({ type: 'cancelled' })
    if (browserResult.error)
      return err({ type: 'error', message: browserResult.error.message })

    // iOS only: approval poll resolved before browser was dismissed.
    if (winner === 'approval') {
      closeAuthBrowser()
      const outcome = await approvalPromise!
      if (outcome.ok) return ok(outcome.result)
      return err({ type: 'error', message: outcome.error.message })
    }

    // Browser dismissed (deep link, manual close, or AppState foreground).
    // Start deferred poll (Android) or reuse existing (iOS).
    if (!approvalPromise) {
      approvalPromise = startApprovalPoll()
    }

    // Give the poll one cycle (6s) to confirm approval, then cancel.
    const grace = await Promise.race([
      approvalPromise.then(() => 'approved' as const),
      new Promise<'timeout'>((r) =>
        setTimeout(() => r('timeout'), BROWSER_CLOSE_GRACE_MS),
      ),
    ])

    if (signal.aborted) return err({ type: 'cancelled' })

    if (grace === 'approved') {
      const outcome = await approvalPromise
      if (outcome.ok) return ok(outcome.result)
      return err({ type: 'error', message: outcome.error.message })
    }

    // Grace period expired — abort the SDK poll and cancel.
    abortController.abort()
    return err({ type: 'cancelled' })
  } finally {
    androidDismissal?.subscription.remove()
    if (authAbortController === abortController) {
      authAbortController = null
    }
  }
}

/**
 * Runs the browser auth flow: request connection → open browser → wait for approval.
 * Returns the builder after approval, or an error if cancelled/failed.
 */
async function runBrowserAuthFlow(
  builder: Builder,
): Promise<Result<BuilderInterface, AuthError>> {
  const [builderAfterRequest, requestErr] =
    await builderRequestConnection(builder)
  if (requestErr) {
    logger.error('sdk', 'connection_request_error', {
      error: requestErr as Error,
    })
    return err({ type: 'error', message: requestErr.message })
  }

  const [builderAfterApproval, approvalErr] =
    await waitForUserApproval(builderAfterRequest)
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

  return ok(builderAfterApproval)
}

// selectors

export const [getIsConnected, useIsConnected] = createGetterAndSelector(
  useSdkStore,
  (s) => s.isConnected,
)

export function useIsAuthing(): boolean {
  return useSdkStore((s) => s.isAuthing)
}

export function getSdk(): SdkInterface | null {
  return useSdkStore.getState().sdk
}

/**
 * Update the metadata of a pinned object.
 */
export async function updateMetadata(
  pinnedObject: PinnedObjectInterface,
  metadata: ArrayBuffer,
): Promise<void> {
  const sdk = getSdk()
  if (!sdk) {
    throw new Error('SDK not initialized')
  }
  pinnedObject.updateMetadata(metadata)
  await sdk.updateObjectMetadata(pinnedObject)
}

/**
 * Fetch a pinned object by id.
 */
export async function getPinnedObject(
  objectId: string,
): Promise<PinnedObjectInterface> {
  const sdk = getSdk()
  if (!sdk) {
    throw new Error('SDK not initialized')
  }
  return sdk.object(objectId)
}

/**
 * Resets the SDK state and shuts down uploader.
 */
export async function resetSdk() {
  await getUploadManager().shutdown()
  setState({
    sdk: null,
    isConnected: false,
    connectionError: null,
    isAuthing: false,
    isReconnecting: false,
    pendingApproval: null,
  })
}

export function useSdk(): SdkInterface | null {
  return useSdkStore((s) => s.sdk)
}
