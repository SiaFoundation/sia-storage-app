import { detectMimeTypeFromBytes } from '@siastorage/core/lib/detectMimeType'

export function detectMimeType(data: ArrayBuffer): string | null {
  return detectMimeTypeFromBytes(new Uint8Array(data))
}
