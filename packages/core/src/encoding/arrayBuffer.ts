import { z } from 'zod'
import { arrayBufferToHex, hexToUint8 } from '../lib/hex'

export const hexArrayBufferCodec = z.codec(z.hex(), z.instanceof(ArrayBuffer), {
  decode: (hex) => hexToUint8(hex).buffer as ArrayBuffer,
  encode: (buf) => arrayBufferToHex(buf),
})
