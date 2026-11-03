const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/**
 * Standard base64 with padding. Written out because core also runs on mobile,
 * where there is no global Buffer, and `btoa` needs a binary string built a
 * character at a time first.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = ''
  let i = 0
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]
    out += ALPHABET[n >> 18] + ALPHABET[(n >> 12) & 63] + ALPHABET[(n >> 6) & 63] + ALPHABET[n & 63]
  }
  const rest = bytes.length - i
  if (rest === 1) {
    const n = bytes[i] << 16
    out += `${ALPHABET[n >> 18]}${ALPHABET[(n >> 12) & 63]}==`
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8)
    out += `${ALPHABET[n >> 18]}${ALPHABET[(n >> 12) & 63]}${ALPHABET[(n >> 6) & 63]}=`
  }
  return out
}
