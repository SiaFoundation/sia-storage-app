import QuickCrypto from 'react-native-quick-crypto'
import { getSecureStoreString, setSecureStoreString } from './secureStore'

const MNEMONIC_HASH_SECURE_STORE_KEY = 'mnemonicHash'

/**
 * The mnemonic hash validates that a user enters the correct recovery phrase
 * when switching indexers, ensuring they derive the same AppKey.
 *
 * Stored in iOS Keychain (via expo-secure-store) which persists across app
 * delete/reinstall. During onboarding the hash is cleared first so a stale
 * hash from a previous install doesn't block registration.
 */

/**
 * Hash a mnemonic using SHA-256.
 */
function hashMnemonic(mnemonic: string): string {
  const h = QuickCrypto.createHash('sha256')
  h.update(mnemonic)
  return h.digest('hex')
}

/**
 * Get the stored mnemonic hash from secure storage.
 * Returns null if no hash exists.
 */
async function getMnemonicHash(): Promise<string | null> {
  const hash = await getSecureStoreString<string>(
    MNEMONIC_HASH_SECURE_STORE_KEY,
    '',
  )
  return hash || null
}

/**
 * Save the mnemonic hash to secure storage.
 */
export async function setMnemonicHash(mnemonic: string): Promise<void> {
  const hash = hashMnemonic(mnemonic)
  await setSecureStoreString(MNEMONIC_HASH_SECURE_STORE_KEY, hash)
}

/**
 * Validate a mnemonic against the stored hash.
 * Returns true if the mnemonic matches, false if it doesn't.
 * Returns null if no hash is stored (new user).
 */
export async function validateMnemonic(
  mnemonic: string,
): Promise<'valid' | 'invalid' | 'none'> {
  const storedHash = await getMnemonicHash()
  if (!storedHash) {
    return 'none' // No hash stored, this is a new user
  }
  const inputHash = hashMnemonic(mnemonic)
  return inputHash === storedHash ? 'valid' : 'invalid'
}

/**
 * Clear the mnemonic hash from secure storage.
 */
export async function clearMnemonicHash(): Promise<void> {
  await setSecureStoreString(MNEMONIC_HASH_SECURE_STORE_KEY, '')
}
