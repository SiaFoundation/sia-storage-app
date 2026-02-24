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
import {
  type AppKey,
  Builder,
  type BuilderInterface,
  type PinnedObjectInterface,
  type SdkInterface,
} from 'react-native-sia'
import { create } from 'zustand'
import { openAuthURL } from '../lib/openAuthUrl'
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
        connectionError: 'Failed to connect to indexer',
      })
    }
    return connected
  } catch (_e) {
    setState({
      isConnected: false,
      connectionError: 'Failed to connect to indexer',
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

export type SwitchError =
  | { type: 'error'; message: string }
  | { type: 'needsReauth' }

export type SwitchResult = Result<void, SwitchError>

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
 * Switches to a new indexer using stored credentials for that specific indexer.
 * Used from settings when changing indexers.
 *
 * AppKeys are unique per indexer URL. If we have a stored AppKey for this
 * specific indexer, we can connect instantly. If not, the user must enter
 * their mnemonic to register with the new indexer.
 *
 * @returns success if connected, `needsReauth` if mnemonic entry required
 */
export async function switchIndexer(
  newIndexerURL: string,
): Promise<SwitchResult> {
  logger.info('sdk', 'indexer_switch', { indexerURL: newIndexerURL })

  // First, check if we have an AppKey specifically for this indexer.
  const appKeyForIndexer = await getAppKeyForIndexer(newIndexerURL)
  if (appKeyForIndexer) {
    const builder = new Builder(newIndexerURL)
    const [sdk, connectedErr] = await builderConnected(
      builder,
      appKeyForIndexer,
    )

    if (connectedErr) {
      logger.error('sdk', 'stored_key_connect_error', {
        error: connectedErr as Error,
      })
      return err({ type: 'error', message: connectedErr.message })
    }

    if (sdk) {
      logger.info('sdk', 'stored_key_connected')
      setIndexerURL(newIndexerURL)
      await setSdkWithUploader(sdk)
      setState({ isConnected: true })
      return ok(undefined)
    }
  }

  // No stored AppKey for this indexer - user needs to enter mnemonic.
  logger.info('sdk', 'no_stored_key')
  return err({ type: 'needsReauth' })
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
        logoUrl: 'https://sia.storage/logo.png',
      }),
      CONNECTION_TIMEOUT_MS,
    )
    return ok(result)
  } catch (e) {
    return err(e as Error)
  }
}

/**
 * Waits for the indexer to confirm app approval.
 */
async function builderWaitForApproval(
  builder: BuilderInterface,
): Promise<Result<BuilderInterface>> {
  try {
    logger.debug('sdk', 'waiting_for_approval')
    const result = await withTimeout(
      builder.waitForApproval(),
      CONNECTION_TIMEOUT_MS,
    )
    return ok(result)
  } catch (e) {
    return err(e as Error)
  }
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
 * Opens auth URL and waits for user approval.
 * Returns { type: 'cancelled' } if user closes browser.
 */
async function waitForUserApproval(
  builder: BuilderInterface,
): Promise<Result<BuilderInterface, AuthError>> {
  const responseUrl = builder.responseUrl()
  const authCompleted = await openAuthURL(responseUrl)

  if (!authCompleted) {
    return err({ type: 'cancelled' })
  }

  const [result, waitErr] = await builderWaitForApproval(builder)
  if (waitErr) {
    return err({ type: 'error', message: waitErr.message })
  }
  return ok(result)
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
