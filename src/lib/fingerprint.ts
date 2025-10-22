import { type Mime } from './fileTypes'

type MediaKind = 'image' | 'video' | 'audio' | 'other'

function kindFromMime(mime?: string | null): MediaKind {
  if (!mime) return 'other'
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  return 'other'
}

/**
 * Builds a versioned, device‑agnostic fingerprint for pre‑dedupe.
 * - Stays stable across iCloud/Android transcodes and minor metadata drift.
 * - Cheap to compute (no byte reads) and deterministic.
 * - Went with the family (image) rather than the exact MIME (image/heic)
 *   because it would split the same photo after a transcode.
 * - This is primarily used for media as at least iOS does not provide a
 *   way to enumerate and sync general files.
 *
 * Format (v1)
 *   v1|{kind}|{width}|{height}|{durationSec}|{size}|{createdAtSec}
 *
 * Fields
 * - kind: 'image' | 'video' | 'audio' | 'other' (from MIME family).
 * - width/height: pixels; 0 when unknown.
 * - durationSec: rounded seconds for video/audio; 0 when N/A.
 * - size: bytes; 0 when unknown.
 * - createdAtSec: rounded seconds since epoch; 0 when unknown.
 *
 */
export function buildFingerprintV1(input: {
  mime?: Mime | string | null
  width?: number
  height?: number
  durationMs?: number
  size?: number | null
  createdAtMs?: number | null
}): string {
  const kind: MediaKind = kindFromMime(input.mime)
  const width = Math.max(0, Number(input.width ?? 0) | 0)
  const height = Math.max(0, Number(input.height ?? 0) | 0)
  const durationSec = Math.max(0, Math.round((input.durationMs ?? 0) / 1000))
  const size = Math.max(0, Number(input.size ?? 0) | 0)
  const createdAtSec = Math.max(0, Math.round((input.createdAtMs ?? 0) / 1000))
  return `v1|${kind}|${width}|${height}|${durationSec}|${size}|${createdAtSec}`
}
