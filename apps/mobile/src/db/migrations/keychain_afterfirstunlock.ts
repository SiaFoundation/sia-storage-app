import { hexArrayBufferCodec } from '@siastorage/core'
import type { DatabaseAdapter } from '@siastorage/core/adapters'
import type { Migration } from '@siastorage/core/db'
import { logger } from '@siastorage/logger'
import {
  deleteSecureStoreItem,
  getSecureStoreJSON,
  setSecureStoreJSON,
} from '../../stores/secureStore'

// Duplicated from src/stores/appKey.ts to keep migration self-contained
// (importing appKey.ts would pull in react-native-sia which breaks Jest)
const APP_KEYS_SECURE_STORE_KEY = 'appKeys'

type AppKeysMap = Record<string, ArrayBuffer>
type AppKeysStorageMap = Record<string, string>

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

async function getAppKeysMap(): Promise<AppKeysMap> {
  return (await getSecureStoreJSON(APP_KEYS_SECURE_STORE_KEY, appKeysCodec)) ?? {}
}

async function setAppKeysMap(map: AppKeysMap): Promise<void> {
  await setSecureStoreJSON(APP_KEYS_SECURE_STORE_KEY, map, appKeysCodec)
}

/**
 * Migrate keychain items to use AFTER_FIRST_UNLOCK accessibility.
 *
 * expo-secure-store's SecItemUpdate does NOT change the kSecAttrAccessible
 * attribute - it only updates the value. To change the accessibility setting,
 * we must DELETE the item first, then ADD it with the new accessibility option.
 *
 * This enables background task access when the device is locked.
 */
export const migration_keychain_afterfirstunlock: Migration = {
  id: 'keychain_afterfirstunlock',
  description: 'Migrate keychain to AFTER_FIRST_UNLOCK accessibility',
  up: async (_db: DatabaseAdapter) => {
    logger.info('db', 'keychain_migration_start')

    const appKeysMap = await getAppKeysMap()
    const keyCount = Object.keys(appKeysMap).length

    if (keyCount === 0) {
      logger.info('db', 'no_keys_to_migrate')
      return
    }

    // Delete the item first - required because SecItemUpdate
    // does not change the kSecAttrAccessible attribute
    await deleteSecureStoreItem(APP_KEYS_SECURE_STORE_KEY)

    // Re-add with AFTER_FIRST_UNLOCK accessibility
    await setAppKeysMap(appKeysMap)

    logger.info('db', 'keychain_migration_complete', { keyCount })
  },
}
