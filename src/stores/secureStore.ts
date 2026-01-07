import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'
import { retry } from '../lib/retry'

// Use AFTER_FIRST_UNLOCK on iOS to allow keychain access in background mode
// when the device is locked (after it has been unlocked once since boot).
// This is required for background upload tasks to access credentials.
const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = Platform.select({
  ios: { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK },
  default: {},
})

export async function setSecureStoreBoolean(key: string, value: boolean) {
  validateKey(key)
  return SecureStore.setItemAsync(key, value ? 'true' : 'false', SECURE_STORE_OPTIONS)
}

export async function getSecureStoreBoolean(key: string, initialValue = false) {
  return retry('getSecureStoreBoolean', async () => {
    const found = await SecureStore.getItemAsync(key, SECURE_STORE_OPTIONS)
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
  return SecureStore.setItemAsync(key, str, SECURE_STORE_OPTIONS)
}

export async function getSecureStoreNumber(key: string, initialValue = 0) {
  return retry('getSecureStoreNumber', async () => {
    const found = await SecureStore.getItemAsync(key, SECURE_STORE_OPTIONS)
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
  return SecureStore.setItemAsync(key, value, SECURE_STORE_OPTIONS)
}

export async function getSecureStoreString<T extends string>(
  key: string,
  initialValue: T
): Promise<T> {
  return retry('getSecureStoreString', async () => {
    const found = await SecureStore.getItemAsync(key, SECURE_STORE_OPTIONS)
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
    return SecureStore.setItemAsync(key, '', SECURE_STORE_OPTIONS)
  }
  try {
    const encoded = codec.encode(value)
    const json = JSON.stringify(encoded)
    return SecureStore.setItemAsync(key, json, SECURE_STORE_OPTIONS)
  } catch {
    return SecureStore.setItemAsync(key, '', SECURE_STORE_OPTIONS)
  }
}

export async function getSecureStoreJSON<TStorage, TDomain>(
  key: string,
  codec: JsonCodec<TStorage, TDomain>,
  initialValue?: TDomain
): Promise<TDomain | undefined> {
  const storedValue = await retry('getSecureStoreJSON', async () => {
    const found = await SecureStore.getItemAsync(key, SECURE_STORE_OPTIONS)
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
