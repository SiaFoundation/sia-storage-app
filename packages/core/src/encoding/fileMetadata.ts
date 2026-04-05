/**
 * Versioned file metadata encoding/decoding for server-side object metadata.
 *
 * Server objects store metadata as JSON in an ArrayBuffer. This module handles
 * two formats:
 *   - v1: Current format with id, kind, thumbForId (discriminated union on kind).
 *   - Future: Versions above MAX_SUPPORTED_VERSION, decoded with lenient defaults.
 *
 * encodeFileMetadata() always writes the current version (v1).
 * decodeFileMetadata() handles both formats gracefully.
 */

import { logger } from '@siastorage/logger'
import { z } from 'zod'
import type { FileKind, FileMetadata, ThumbSize } from '../types/files'

export const MAX_SUPPORTED_VERSION = 1

const ThumbSizeSchema = z.union([z.literal(64), z.literal(512)])

const BaseV1Fields = {
  version: z.literal(1),
  id: z.string(),
  name: z.string(),
  type: z.string(),
  size: z.number(),
  hash: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
}

const FileV1Schema = z.object({
  ...BaseV1Fields,
  kind: z.literal('file'),
  tags: z.array(z.string()).optional(),
  directory: z.string().optional(),
  trashedAt: z.number().nullable().optional(),
})

const ThumbV1Schema = z.object({
  ...BaseV1Fields,
  kind: z.literal('thumb'),
  thumbForId: z.string(),
  thumbSize: ThumbSizeSchema,
})

const MetadataV1Schema = z.discriminatedUnion('kind', [FileV1Schema, ThumbV1Schema])

// Forward-compatibility: when a newer app version writes metadata with a
// version above MAX_SUPPORTED_VERSION, older clients use this lenient schema
// to extract whatever v1-compatible fields they can (with safe defaults).
const FutureVersionSchema = z.object({
  version: z.number(),
  id: z.string().catch(''),
  name: z.string().catch(''),
  type: z.string().catch(''),
  kind: z.enum(['file', 'thumb']).catch('file' as const),
  size: z.number().catch(0),
  hash: z.string().catch(''),
  createdAt: z.number().catch(0),
  updatedAt: z.number().catch(0),
  thumbForId: z.string().optional(),
  thumbSize: z.number().optional(),
  tags: z.array(z.string()).optional(),
  directory: z.string().optional(),
  trashedAt: z.number().nullable().optional(),
})

export function encodeFileMetadata(meta: FileMetadata): ArrayBuffer {
  const payload: Record<string, unknown> = {
    version: 1,
    id: meta.id,
    name: meta.name,
    type: meta.type,
    kind: meta.kind,
    size: meta.size,
    hash: meta.hash,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
  }
  if (meta.kind === 'file') {
    if (meta.tags) payload.tags = meta.tags
    if (meta.directory) payload.directory = meta.directory
    payload.trashedAt = meta.trashedAt
  } else if (meta.kind === 'thumb') {
    payload.thumbForId = meta.thumbForId
    payload.thumbSize = meta.thumbSize
  }
  return new TextEncoder().encode(JSON.stringify(payload)).buffer as ArrayBuffer
}

/**
 * Decode metadata from a server object's ArrayBuffer.
 * Tries in order: v1 (current) → future version (lenient).
 * Returns empty metadata on parse failure so callers always get a safe value.
 */
export function decodeFileMetadata(buffer?: ArrayBuffer): FileMetadata {
  try {
    const raw = JSON.parse(new TextDecoder().decode(buffer))

    if (typeof raw.version === 'number') {
      if (raw.version > MAX_SUPPORTED_VERSION) {
        logger.warn('fileMetadata', 'version_exceeds_max', {
          version: raw.version,
          max: MAX_SUPPORTED_VERSION,
        })
        const parsed = FutureVersionSchema.safeParse(raw)
        if (parsed.success) {
          return toFileMetadata(parsed.data)
        }
        logger.warn('fileMetadata', 'future_version_parse_failed', {
          version: raw.version,
        })
        return emptyMetadata()
      }

      const parsed = MetadataV1Schema.safeParse(raw)
      if (parsed.success) {
        return toFileMetadata(parsed.data)
      }
      // V1 strict parse failed (e.g., orphaned thumb missing thumbForId).
      // Try lenient parse to preserve id, kind, and other valid fields.
      logger.warn('fileMetadata', 'v1_parse_failed', {
        errors: parsed.error.issues.map((i) => i.message),
      })
      const lenient = FutureVersionSchema.safeParse(raw)
      if (lenient.success) {
        return toFileMetadata(lenient.data)
      }
      logger.warn('fileMetadata', 'v1_lenient_also_failed', {
        errors: lenient.error.issues.map((i) => `${i.path}: ${i.message}`),
        rawKind: raw.kind,
        hasThumbForId: raw.thumbForId !== undefined,
        thumbForIdType: typeof raw.thumbForId,
      })
    }

    return emptyMetadata()
  } catch (e) {
    logger.error('fileMetadata', 'decode_error', { error: e as Error })
    return emptyMetadata()
  }
}

export function hasCompleteFileMetadata(metadata: FileMetadata): boolean {
  return (
    !!metadata.id &&
    !!metadata.hash &&
    !!metadata.type &&
    !!metadata.name &&
    !!metadata.size &&
    !!metadata.updatedAt &&
    !!metadata.createdAt
  )
}

export function hasCompleteThumbnailMetadata(metadata: FileMetadata): boolean {
  return hasCompleteFileMetadata(metadata) && !!metadata.thumbForId && !!metadata.thumbSize
}

function toFileMetadata(
  data: z.infer<typeof MetadataV1Schema> | z.infer<typeof FutureVersionSchema>,
): FileMetadata {
  const kind = data.kind as FileKind
  const d = data as Record<string, unknown>
  const result: FileMetadata = {
    id: data.id,
    name: data.name,
    type: data.type,
    kind,
    size: data.size,
    hash: data.hash,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    trashedAt: null,
  }
  if (kind === 'file') {
    result.tags = d.tags as string[] | undefined
    result.directory = d.directory as string | undefined
    result.trashedAt = (d.trashedAt as number | null | undefined) ?? null
  } else if (kind === 'thumb') {
    result.thumbForId = d.thumbForId as string | undefined
    result.thumbSize = d.thumbSize as ThumbSize | undefined
  }
  return result
}

function emptyMetadata(): FileMetadata {
  return {
    id: '',
    name: '',
    type: '',
    kind: 'file',
    size: 0,
    hash: '',
    createdAt: 0,
    updatedAt: 0,
    trashedAt: null,
  }
}
