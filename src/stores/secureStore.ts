import * as SecureStore from 'expo-secure-store'

export async function setSecureStoreBoolean(key: string, value: boolean) {
  if (!/^[a-zA-Z0-9._-]+$/.test(key)) {
    throw new Error(
      'SecureStore key must contain only alphanumeric characters, dots, hyphens, and underscores'
    )
  }
  return SecureStore.setItemAsync(key, value ? 'true' : 'false')
}

export async function getSecureStoreBoolean(key: string, initialValue = false) {
  try {
    const found = await SecureStore.getItemAsync(key)
    if (typeof found === 'string') {
      if (found === 'true') {
        return true
      } else {
        return false
      }
    }
    setSecureStoreBoolean(key, initialValue)
    return initialValue
  } catch {
    return initialValue
  }
}

export async function setSecureStoreNumber(key: string, value: number) {
  if (!/^[a-zA-Z0-9._-]+$/.test(key)) {
    throw new Error(
      'SecureStore key must contain only alphanumeric characters, dots, hyphens, and underscores'
    )
  }
  const str = Number.isFinite(value) ? String(Math.floor(value)) : '0'
  return SecureStore.setItemAsync(key, str)
}

export async function getSecureStoreNumber(key: string, initialValue = 0) {
  try {
    const found = await SecureStore.getItemAsync(key)
    if (typeof found === 'string' && found.trim().length > 0) {
      const n = Number(found)
      if (Number.isFinite(n)) {
        return n
      }
      setSecureStoreNumber(key, initialValue)
    }
    return initialValue
  } catch {
    return initialValue
  }
}

export async function setSecureStoreString<T extends string>(
  key: string,
  value: T
) {
  if (!/^[a-zA-Z0-9._-]+$/.test(key)) {
    throw new Error(
      'SecureStore key must contain only alphanumeric characters, dots, hyphens, and underscores'
    )
  }
  return SecureStore.setItemAsync(key, value)
}

export async function getSecureStoreString<T extends string>(
  key: string,
  initialValue: T
): Promise<T> {
  try {
    const found = await SecureStore.getItemAsync(key)
    if (typeof found === 'string' && found.trim().length > 0) {
      return found as T
    }
    setSecureStoreString(key, initialValue)
    return initialValue
  } catch {
    return initialValue
  }
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
  if (!/^[a-zA-Z0-9._-]+$/.test(key)) {
    throw new Error(
      'SecureStore key must contain only alphanumeric characters, dots, hyphens, and underscores'
    )
  }
  if (value == null) {
    return SecureStore.setItemAsync(key, '')
  }
  try {
    const encoded = codec.encode(value)
    const json = JSON.stringify(encoded)
    return SecureStore.setItemAsync(key, json)
  } catch {
    return SecureStore.setItemAsync(key, '')
  }
}

export async function getSecureStoreJSON<TStorage, TDomain>(
  key: string,
  codec: JsonCodec<TStorage, TDomain>,
  initialValue?: TDomain
): Promise<TDomain | undefined> {
  try {
    const found = await SecureStore.getItemAsync(key)
    if (typeof found !== 'string' || found.trim().length === 0) {
      setSecureStoreJSON(key, initialValue, codec)
      return initialValue
    }
    const parsed = JSON.parse(found) as TStorage
    return codec.decode(parsed)
  } catch {
    return initialValue
  }
}
