import * as SecureStore from 'expo-secure-store'

export async function setSecureStoreBoolean(key: string, value: boolean) {
  if (!/^[a-zA-Z0-9._-]+$/.test(key)) {
    throw new Error(
      'SecureStore key must contain only alphanumeric characters, dots, hyphens, and underscores'
    )
  }
  return SecureStore.setItemAsync(key, value ? 'true' : 'false')
}

export async function getSecureStoreBoolean(key: string, fallback = false) {
  try {
    const found = await SecureStore.getItemAsync(key)
    if (typeof found === 'string') {
      if (found === 'true') {
        return true
      } else {
        return false
      }
    }
    return fallback
  } catch {
    return fallback
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

export async function getSecureStoreNumber(key: string, fallback = 0) {
  try {
    const found = await SecureStore.getItemAsync(key)
    if (typeof found === 'string' && found.trim().length > 0) {
      const n = Number(found)
      return Number.isFinite(n) ? n : fallback
    }
    return fallback
  } catch {
    return fallback
  }
}

export async function setSecureStoreString(key: string, value: string) {
  if (!/^[a-zA-Z0-9._-]+$/.test(key)) {
    throw new Error(
      'SecureStore key must contain only alphanumeric characters, dots, hyphens, and underscores'
    )
  }
  return SecureStore.setItemAsync(key, value)
}

export async function getSecureStoreString(key: string, fallback = '') {
  try {
    const found = await SecureStore.getItemAsync(key)
    return found || fallback
  } catch {
    return fallback
  }
}
