export function uint8ToHex(u8: Uint8Array): string {
  return [...u8].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function hexToUint8(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('Invalid hex string')
  return new Uint8Array(hex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)))
}

export function arrayBufferToHex(arrayBuffer: ArrayBuffer): string {
  return uint8ToHex(new Uint8Array(arrayBuffer))
}
