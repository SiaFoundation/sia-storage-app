import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'
import { getAppGroup } from '../lib/sharedContainer'

// Use AFTER_FIRST_UNLOCK on iOS to allow keychain access in background mode
// when the device is locked (after it has been unlocked once since boot).
// This is required for background upload tasks to access credentials.
const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = Platform.select({
  ios: {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
    ...(getAppGroup() && { accessGroup: getAppGroup() }),
  },
  default: {},
})

async function getItem(key: string): Promise<string | null> {
  return SecureStore.getItemAsync(key, SECURE_STORE_OPTIONS)
}

async function setItem(key: string, value: string): Promise<void> {
  return SecureStore.setItemAsync(key, value, SECURE_STORE_OPTIONS)
}

/**
 * Delete an item from SecureStore. Used by migration to force re-creation
 * of items with updated accessibility settings.
 */
export async function deleteSecureStoreItem(key: string): Promise<void> {
  validateKey(key)
  await SecureStore.deleteItemAsync(key, SECURE_STORE_OPTIONS)
}

export async function setSecureStoreBoolean(key: string, value: boolean) {
  validateKey(key)
  return setItem(key, value ? 'true' : 'false')
}

export async function getSecureStoreBoolean(key: string, initialValue = false) {
  const found = await getItem(key)
  if (typeof found === 'string') {
    if (found === 'true') {
      return true
    }
    return false
  }
  await setSecureStoreBoolean(key, initialValue)
  return initialValue
}

export async function setSecureStoreNumber(key: string, value: number) {
  validateKey(key)
  const str = Number.isFinite(value) ? String(Math.floor(value)) : '0'
  return setItem(key, str)
}

export async function getSecureStoreNumber(key: string, initialValue = 0) {
  const found = await getItem(key)
  if (typeof found === 'string' && found.trim().length > 0) {
    const n = Number(found)
    if (Number.isFinite(n)) {
      return n
    }
    await setSecureStoreNumber(key, initialValue)
  }
  return initialValue
}

export async function setSecureStoreString<T extends string>(
  key: string,
  value: T,
) {
  validateKey(key)
  return setItem(key, value)
}

export async function getSecureStoreString<T extends string>(
  key: string,
  initialValue: T,
): Promise<T> {
  const found = await getItem(key)
  if (typeof found === 'string' && found.trim().length > 0) {
    return found as T
  }
  await setSecureStoreString(key, initialValue)
  return initialValue
}

export type JsonCodec<TStorage, TDomain> = {
  encode: (domain: TDomain) => TStorage
  decode: (storage: TStorage) => TDomain
}

export async function setSecureStoreJSON<TStorage, TDomain>(
  key: string,
  value: TDomain | undefined,
  codec: JsonCodec<TStorage, TDomain>,
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
  initialValue?: TDomain,
): Promise<TDomain | undefined> {
  const found = await getItem(key)
  if (typeof found === 'string' && found.trim().length > 0) {
    const parsed = JSON.parse(found) as TStorage
    return codec.decode(parsed)
  }
  await setSecureStoreJSON(key, initialValue, codec)
  return initialValue
}

export function validateKey(key: string) {
  if (!/^[a-zA-Z0-9._-]+$/.test(key)) {
    throw new Error(
      'SecureStore key must contain only alphanumeric characters, dots, hyphens, and underscores',
    )
  }
}
