import AsyncStorage from '@react-native-async-storage/async-storage'
import type { StorageAdapter } from '@siastorage/core/adapters'
import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'
import { getAppGroup } from '../lib/sharedContainer'

const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = Platform.select({
  ios: {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
    ...(getAppGroup() && { accessGroup: getAppGroup() }),
  },
  default: {},
})

export function createStorageAdapter(): StorageAdapter {
  return {
    getItem: (key) => AsyncStorage.getItem(key),
    setItem: (key, value) => AsyncStorage.setItem(key, value),
    deleteItem: (key) => AsyncStorage.removeItem(key),
  }
}

export function createSecretsAdapter(): StorageAdapter {
  return {
    getItem: (key) => SecureStore.getItemAsync(key, SECURE_STORE_OPTIONS),
    setItem: (key, value) => SecureStore.setItemAsync(key, value, SECURE_STORE_OPTIONS),
    deleteItem: (key) => SecureStore.deleteItemAsync(key, SECURE_STORE_OPTIONS),
  }
}
