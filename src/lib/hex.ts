export function uint8ToHex(u8: Uint8Array): string {
  return [...u8].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function hexToUint8(hex: string): Uint8Array<ArrayBuffer> {
  if (hex.length === 0) return new Uint8Array()
  if (hex.length % 2 !== 0) throw new Error('Invalid hex string')
  const bytes = hex.match(/.{1,2}/g)
  if (bytes == null) return new Uint8Array()
  return new Uint8Array(bytes.map((byte) => parseInt(byte, 16)))
}

export function arrayBufferToHex(arrayBuffer: ArrayBuffer): string {
  return uint8ToHex(new Uint8Array(arrayBuffer))
}
