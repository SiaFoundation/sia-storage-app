import * as SecureStore from 'expo-secure-store'

export async function setSecureStoreBoolean(key: string, value: boolean) {
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
