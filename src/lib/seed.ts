import { generateEncryptionKey } from './encryptionKey'

export function createSeed() {
  return generateEncryptionKey()
}
