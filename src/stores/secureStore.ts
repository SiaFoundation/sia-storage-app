import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'
import Constants from 'expo-constants'
import { retry } from '../lib/retry'

// Check if running in E2E test mode (set via E2E_TEST=true during build)
export const isE2ETest = Constants.expoConfig?.extra?.e2eTest === true

// In-memory KV store for E2E test mode.
// On CI simulators, iOS Keychain's SecItemCopyMatching makes synchronous XPC calls
// to securityd that can hang indefinitely. This in-memory store bypasses the native
// keychain entirely in E2E mode. E2E tests always start fresh, so there's no
// persisted data to retrieve anyway.
const e2eStore = new Map<string, string>()

// Use AFTER_FIRST_UNLOCK on iOS to allow keychain access in background mode
// when the device is locked (after it has been unlocked once since boot).
// This is required for background upload tasks to access credentials.
const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = Platform.select({
  ios: { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK },
  default: {},
})

/**
 * Get item from secure storage.
 * In E2E mode, uses in-memory store to avoid iOS Keychain hangs.
 */
async function getItem(key: string): Promise<string | null> {
  if (isE2ETest) {
    return e2eStore.get(key) ?? null
  }
  return SecureStore.getItemAsync(key, SECURE_STORE_OPTIONS)
}

/**
 * Set item in secure storage.
 * In E2E mode, uses in-memory store to avoid iOS Keychain hangs.
 */
async function setItem(key: string, value: string): Promise<void> {
  if (isE2ETest) {
    e2eStore.set(key, value)
    return
  }
  return SecureStore.setItemAsync(key, value, SECURE_STORE_OPTIONS)
}

export async function setSecureStoreBoolean(key: string, value: boolean) {
  validateKey(key)
  return setItem(key, value ? 'true' : 'false')
}

export async function getSecureStoreBoolean(key: string, initialValue = false) {
  return retry('getSecureStoreBoolean', async () => {
    const found = await getItem(key)
    if (typeof found === 'string') {
      if (found === 'true') {
        return true
      } else {
        return false
      }
    }
    await setSecureStoreBoolean(key, initialValue)
    return initialValue
  })
}

export async function setSecureStoreNumber(key: string, value: number) {
  validateKey(key)
  const str = Number.isFinite(value) ? String(Math.floor(value)) : '0'
  return setItem(key, str)
}

export async function getSecureStoreNumber(key: string, initialValue = 0) {
  return retry('getSecureStoreNumber', async () => {
    const found = await getItem(key)
    if (typeof found === 'string' && found.trim().length > 0) {
      const n = Number(found)
      if (Number.isFinite(n)) {
        return n
      }
      await setSecureStoreNumber(key, initialValue)
    }
    return initialValue
  })
}

export async function setSecureStoreString<T extends string>(
  key: string,
  value: T
) {
  validateKey(key)
  return setItem(key, value)
}

export async function getSecureStoreString<T extends string>(
  key: string,
  initialValue: T
): Promise<T> {
  return retry('getSecureStoreString', async () => {
    const found = await getItem(key)
    if (typeof found === 'string' && found.trim().length > 0) {
      return found as T
    }
    await setSecureStoreString(key, initialValue)
    return initialValue
  })
}

export type JsonCodec<TStorage, TDomain> = {
  encode: (domain: TDomain) => TStorage
  decode: (storage: TStorage) => TDomain
}

export async function setSecureStoreJSON<TStorage, TDomain>(
  key: string,
  value: TDomain | undefined,
  codec: JsonCodec<TStorage, TDomain>
) {
  validateKey(key)
  if (value == null) {
    return setItem(key, '')
  }
  try {
    const encoded = codec.encode(value)
    const json = JSON.stringify(encoded)
    return setItem(key, json)
  } catch {
    return setItem(key, '')
  }
}

export async function getSecureStoreJSON<TStorage, TDomain>(
  key: string,
  codec: JsonCodec<TStorage, TDomain>,
  initialValue?: TDomain
): Promise<TDomain | undefined> {
  const storedValue = await retry('getSecureStoreJSON', async () => {
    const found = await getItem(key)
    if (typeof found !== 'string' || found.trim().length === 0) {
      return undefined
    }
    return found
  })
  if (storedValue) {
    const parsed = JSON.parse(storedValue) as TStorage
    return codec.decode(parsed)
  } else {
    await setSecureStoreJSON(key, initialValue, codec)
    return initialValue
  }
}

export function validateKey(key: string) {
  if (!/^[a-zA-Z0-9._-]+$/.test(key)) {
    throw new Error(
      'SecureStore key must contain only alphanumeric characters, dots, hyphens, and underscores'
    )
  }
}
