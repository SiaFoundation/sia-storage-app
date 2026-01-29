/**
 * In-memory mock for expo-secure-store.
 */

const store = new Map<string, string>()

export const AFTER_FIRST_UNLOCK = 'AFTER_FIRST_UNLOCK'
export const AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY =
  'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY'
export const ALWAYS = 'ALWAYS'
export const ALWAYS_THIS_DEVICE_ONLY = 'ALWAYS_THIS_DEVICE_ONLY'
export const WHEN_PASSCODE_SET_THIS_DEVICE_ONLY =
  'WHEN_PASSCODE_SET_THIS_DEVICE_ONLY'
export const WHEN_UNLOCKED = 'WHEN_UNLOCKED'
export const WHEN_UNLOCKED_THIS_DEVICE_ONLY = 'WHEN_UNLOCKED_THIS_DEVICE_ONLY'

export async function getItemAsync(
  key: string,
  _options?: { keychainAccessible?: string },
): Promise<string | null> {
  return store.get(key) ?? null
}

export async function setItemAsync(
  key: string,
  value: string,
  _options?: { keychainAccessible?: string },
): Promise<void> {
  store.set(key, value)
}

export async function deleteItemAsync(
  key: string,
  _options?: { keychainAccessible?: string },
): Promise<void> {
  store.delete(key)
}

export function isAvailableAsync(): Promise<boolean> {
  return Promise.resolve(true)
}

export function clearStore(): void {
  store.clear()
}

export function getStoreSnapshot(): Map<string, string> {
  return new Map(store)
}
