import * as SecureStore from 'expo-secure-store'
import {
  encryptionKeyHexToUint8,
  encryptionKeyUint8ToHex,
  generateEncryptionKey,
} from './encryptionKey'

const seedKey = 'siamobile-seed'

export function createSeed() {
  return generateEncryptionKey()
}

export async function storeSeed(
  seed: Uint8Array<ArrayBuffer>
): Promise<boolean> {
  const seedString = encryptionKeyUint8ToHex(seed)
  try {
    await SecureStore.setItemAsync(seedKey, seedString)
    return true
  } catch {
    return false
  }
}

export async function loadSeed(): Promise<Uint8Array<ArrayBuffer> | null> {
  const seedString = await SecureStore.getItemAsync(seedKey)
  if (!seedString) return null
  return encryptionKeyHexToUint8(seedString)
}
