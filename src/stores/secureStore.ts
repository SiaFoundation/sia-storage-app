import * as SecureStore from 'expo-secure-store'

export async function setSecureStoreBoolean(key: string, value: boolean) {
  if (!/^[a-zA-Z0-9._-]+$/.test(key)) {
    throw new Error(
      'SecureStore key must contain only alphanumeric characters, dots, hyphens, and underscores'
    )
  }
  return SecureStore.setItemAsync(key, value ? 'true' : 'false')
}

export async function getSecureStoreBoolean(key: string) {
  try {
    const found = await SecureStore.getItemAsync(key)
    if (found === 'true') {
      return true
    } else {
      return false
    }
  } catch {
    return false
  }
}
