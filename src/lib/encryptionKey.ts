export function generateEncryptionKey(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export function encryptionKeyToHex(encryptionKey: ArrayBuffer): string {
  return Array.from(new Uint8Array(encryptionKey))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
