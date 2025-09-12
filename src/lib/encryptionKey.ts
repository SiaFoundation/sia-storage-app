import { arrayBufferToHex, hexToUint8, uint8ToHex } from './hex'
// Required for `crypto.getRandomValues()`
import 'react-native-get-random-values'

export function generateEncryptionKeyHex(): string {
  return uint8ToHex(generateEncryptionKey())
}

export function generateEncryptionKey(): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return bytes
}

export function encryptionKeyUint8ToHex(
  encryptionKey: Uint8Array<ArrayBuffer>
): string {
  return uint8ToHex(encryptionKey)
}

export function encryptionKeyHexToUint8(
  encryptionKey: string
): Uint8Array<ArrayBuffer> {
  return hexToUint8(encryptionKey)
}

export function encryptionKeyHexToBuffer(encryptionKey: string): ArrayBuffer {
  return hexToUint8(encryptionKey).slice().buffer
}

export function encryptionKeyArrayBufferToHex(
  encryptionKey: ArrayBuffer
): string {
  return arrayBufferToHex(encryptionKey)
}
