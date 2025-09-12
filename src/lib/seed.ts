import * as SecureStore from 'expo-secure-store'
import { Buffer } from 'buffer'
import 'react-native-get-random-values'

const seedKey = 'siamobile-seed'

export function createSeed() {
  const newSeed = new Uint8Array(32)
  crypto.getRandomValues(newSeed)
  if (newSeed.length !== 32) throw new Error('createseed seed length error')
  return newSeed
}

export async function storeSeed(seed: Uint8Array) {
  const seedString = Buffer.from(seed).toString('base64')
  try {
    await SecureStore.setItemAsync(seedKey, seedString)
    return true
  } catch {
    return false
  }
}

export async function loadSeed() {
  const seedString = await SecureStore.getItemAsync(seedKey)
  if (!seedString) return null
  return new Uint8Array(Buffer.from(seedString, 'base64'))
}
