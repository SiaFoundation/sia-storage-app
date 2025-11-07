import { logger } from '../lib/logger'
import { FileMetadata } from '../stores/files'

export function transformFileMetadata(metadata: FileMetadata): FileMetadata {
  return {
    name: metadata.name,
    type: metadata.type,
    size: metadata.size,
    updatedAt: metadata.updatedAt,
    createdAt: metadata.createdAt,
    hash: metadata.hash,
    thumbForHash: metadata.thumbForHash,
    thumbSize: metadata.thumbSize,
  }
}

export function encodeFileMetadata(params: FileMetadata): ArrayBuffer {
  return new TextEncoder().encode(JSON.stringify(transformFileMetadata(params)))
    .buffer as ArrayBuffer
}

export function decodeFileMetadata(buffer?: ArrayBuffer): FileMetadata {
  try {
    return transformFileMetadata(JSON.parse(new TextDecoder().decode(buffer)))
  } catch (e) {
    logger.log('Error converting file metadata from buffer', e)
    return {
      name: '',
      size: 0,
      type: '',
      updatedAt: 0,
      createdAt: 0,
      hash: '',
      thumbForHash: undefined,
      thumbSize: undefined,
    }
  }
}

/// Checks for complete metadata, most importantly the presence of the hash.
export function hasCompleteMetadata(metadata: FileMetadata): boolean {
  return (
    !!metadata.hash &&
    !!metadata.type &&
    !!metadata.name &&
    !!metadata.size &&
    !!metadata.updatedAt &&
    !!metadata.createdAt
  )
}
