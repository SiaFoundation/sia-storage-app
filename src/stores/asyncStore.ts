import AsyncStorage from '@react-native-async-storage/async-storage'
import { retry } from '../lib/retry'

export async function setAsyncStorageBoolean(key: string, value: boolean) {
  validateKey(key)
  return AsyncStorage.setItem(key, value ? 'true' : 'false')
}

export async function getAsyncStorageBoolean(
  key: string,
  initialValue = false,
) {
  return retry('getAsyncStorageBoolean', async () => {
    const found = await AsyncStorage.getItem(key)
    if (typeof found === 'string') {
      if (found === 'true') {
        return true
      } else {
        return false
      }
    }
    await setAsyncStorageBoolean(key, initialValue)
    return initialValue
  })
}

export async function setAsyncStorageNumber(key: string, value: number) {
  validateKey(key)
  const str = Number.isFinite(value) ? String(Math.floor(value)) : '0'
  return AsyncStorage.setItem(key, str)
}

export async function getAsyncStorageNumber(key: string, initialValue = 0) {
  return retry('getAsyncStorageNumber', async () => {
    const found = await AsyncStorage.getItem(key)
    if (typeof found === 'string' && found.trim().length > 0) {
      const n = Number(found)
      if (Number.isFinite(n)) {
        return n
      }
      await setAsyncStorageNumber(key, initialValue)
    }
    return initialValue
  })
}

export async function setAsyncStorageString<T extends string>(
  key: string,
  value: T,
) {
  validateKey(key)
  return AsyncStorage.setItem(key, value)
}

export async function getAsyncStorageString<T extends string>(
  key: string,
  initialValue: T,
): Promise<T> {
  return retry('getAsyncStorageString', async () => {
    const found = await AsyncStorage.getItem(key)
    if (typeof found === 'string' && found.trim().length > 0) {
      return found as T
    }
    await setAsyncStorageString(key, initialValue)
    return initialValue
  })
}

export type JsonCodec<TStorage, TDomain> = {
  encode: (domain: TDomain) => TStorage
  decode: (storage: TStorage) => TDomain
}

export async function setAsyncStorageJSON<TStorage, TDomain>(
  key: string,
  value: TDomain | undefined,
  codec: JsonCodec<TStorage, TDomain>,
) {
  validateKey(key)
  if (value == null) {
    return AsyncStorage.setItem(key, '')
  }
  try {
    const encoded = codec.encode(value)
    const json = JSON.stringify(encoded)
    return AsyncStorage.setItem(key, json)
  } catch {
    return AsyncStorage.setItem(key, '')
  }
}

export async function getAsyncStorageJSON<TStorage, TDomain>(
  key: string,
  codec: JsonCodec<TStorage, TDomain>,
  initialValue?: TDomain,
): Promise<TDomain | undefined> {
  const storedValue = await retry('getAsyncStorageJSON', async () => {
    const found = await AsyncStorage.getItem(key)
    if (typeof found !== 'string' || found.trim().length === 0) {
      return undefined
    }
    return found
  })
  if (storedValue) {
    const parsed = JSON.parse(storedValue) as TStorage
    return codec.decode(parsed)
  } else {
    await setAsyncStorageJSON(key, initialValue, codec)
    return initialValue
  }
}

export function validateKey(key: string) {
  if (!/^[a-zA-Z0-9._-]+$/.test(key)) {
    throw new Error(
      'AsyncStore key must contain only alphanumeric characters, dots, hyphens, and underscores',
    )
  }
}
