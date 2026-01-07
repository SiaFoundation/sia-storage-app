import { AppKey, AppKeyInterface } from 'react-native-sia'
import { getSecureStoreJSON, setSecureStoreJSON } from './secureStore'
import { createGetterAndSWRHook } from '../lib/selectors'
import { buildSWRHelpers } from '../lib/swr'
import { getIndexerURL } from './settings'
import { hexArrayBufferCodec } from '../encoding/arrayBuffer'
import { logger } from '../lib/logger'

const appKeySwr = buildSWRHelpers('appKey')

/**
 * AppKeys are stored per indexer URL. Each indexer has its own AppKey derived
 * from the same mnemonic + indexer. This allows switching between previously
 * authenticated indexers without re-entering the recovery phrase.
 */

const APP_KEYS_SECURE_STORE_KEY = 'appKeys'

// In-memory cache of appKeys map for background task access.
let cachedAppKeys: Map<string, ArrayBuffer> = new Map()

/**
 * Check if the AppKey cache is populated (for diagnostic logging).
 * Returns true if at least one AppKey is cached in memory.
 */
export function hasCachedAppKey(): boolean {
  return cachedAppKeys.size > 0
}

/**
 * AppKeys map type: indexerURL → AppKey ArrayBuffer
 */
type AppKeysMap = Record<string, ArrayBuffer>

/**
 * AppKeys storage type: indexerURL → AppKey hex string
 */
type AppKeysStorageMap = Record<string, string>

/**
 * Get the AppKey for a specific indexer URL.
 */
export async function getAppKeyForIndexer(
  indexerURL: string
): Promise<AppKey | undefined> {
  // Check cache first.
  const cached = cachedAppKeys.get(indexerURL)
  if (cached) {
    logger.debug('appKey', 'cache hit, using cached AppKey')
    return new AppKey(cached)
  }

  // Load from storage.
  logger.debug('appKey', 'cache miss, loading from SecureStore...')
  const appKeysMap = await getAppKeysMap()
  const keyBuffer = appKeysMap[indexerURL]
  if (!keyBuffer) {
    logger.debug('appKey', 'AppKey not found in SecureStore')
    return undefined
  }

  logger.debug('appKey', 'AppKey loaded from SecureStore, caching')
  cachedAppKeys.set(indexerURL, keyBuffer)
  return new AppKey(keyBuffer)
}

/**
 * Get the AppKey for the currently active indexer.
 */
export const [getAppKey, useAppKey] = createGetterAndSWRHook<AppKey>(
  appKeySwr.getKey(),
  async () => {
    const indexerURL = await getIndexerURL()
    const appKey = await getAppKeyForIndexer(indexerURL)
    if (!appKey) {
      throw new Error('AppKey not found for active indexer')
    }
    return appKey
  }
)

/**
 * Set the AppKey for a specific indexer URL.
 */
export async function setAppKeyForIndexer(
  indexerURL: string,
  appKey: AppKeyInterface
): Promise<void> {
  const exported = appKey.export_()
  cachedAppKeys.set(indexerURL, exported)

  const appKeysMap = await getAppKeysMap()
  appKeysMap[indexerURL] = exported
  await setAppKeysMap(appKeysMap)
  appKeySwr.triggerChange()
}

/**
 * Check if an AppKey exists for a specific indexer.
 */
export async function hasAppKeyForIndexer(
  indexerURL: string
): Promise<boolean> {
  const appKeysMap = await getAppKeysMap()
  return indexerURL in appKeysMap
}

/**
 * Get all indexer URLs that have stored AppKeys.
 */
export async function getRegisteredIndexerURLs(): Promise<string[]> {
  const appKeysMap = await getAppKeysMap()
  return Object.keys(appKeysMap)
}

const appKeysCodec = {
  encode: (map: AppKeysMap): AppKeysStorageMap => {
    const storageMap: AppKeysStorageMap = {}
    for (const [url, buffer] of Object.entries(map)) {
      storageMap[url] = hexArrayBufferCodec.encode(buffer)
    }
    return storageMap
  },
  decode: (storageMap: AppKeysStorageMap): AppKeysMap => {
    const map: AppKeysMap = {}
    for (const [url, hexString] of Object.entries(storageMap)) {
      map[url] = hexArrayBufferCodec.decode(hexString)
    }
    return map
  },
}

/**
 * Get the AppKeys map from storage.
 */
async function getAppKeysMap(): Promise<AppKeysMap> {
  return (
    (await getSecureStoreJSON(APP_KEYS_SECURE_STORE_KEY, appKeysCodec)) ?? {}
  )
}

/**
 * Save the AppKeys map to storage.
 */
async function setAppKeysMap(map: AppKeysMap): Promise<void> {
  await setSecureStoreJSON(APP_KEYS_SECURE_STORE_KEY, map, appKeysCodec)
}

/**
 * Clears all AppKeys from storage.
 */
export async function clearAppKeys(): Promise<void> {
  await setSecureStoreJSON(APP_KEYS_SECURE_STORE_KEY, undefined, appKeysCodec)
  cachedAppKeys.clear()
  appKeySwr.triggerChange()
}

/**
 * Migrate keychain items to use AFTER_FIRST_UNLOCK accessibility.
 * This re-writes stored AppKeys with the new accessibility setting,
 * allowing them to be accessed in background mode.
 *
 * This migration only works in foreground (when device is unlocked)
 * because it needs to read items stored with the old WHEN_UNLOCKED setting.
 */
export async function migrateKeychainAccessibility(): Promise<void> {
  try {
    logger.info('appKey', 'Starting keychain accessibility migration...')

    // Read the current AppKeys map (will use new options, but can still read old items in foreground)
    const appKeysMap = await getAppKeysMap()
    const keyCount = Object.keys(appKeysMap).length

    if (keyCount === 0) {
      logger.info('appKey', 'No AppKeys to migrate')
      return
    }

    // Re-write the AppKeys with new accessibility options
    await setAppKeysMap(appKeysMap)

    logger.info(
      'appKey',
      `Keychain accessibility migration complete: migrated ${keyCount} key(s)`
    )
  } catch (error) {
    // This can fail in background mode - that's expected
    logger.warn(
      'appKey',
      'Keychain accessibility migration failed (expected if in background):',
      error
    )
  }
}
