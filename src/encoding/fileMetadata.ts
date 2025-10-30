import { logger } from '../lib/logger'
import { FileMetadata } from '../stores/files'

export function transformFileMetadata(metadata: FileMetadata): FileMetadata {
  return {
    fileName: metadata.fileName,
    fileType: metadata.fileType,
    fileSize: metadata.fileSize,
    updatedAt: metadata.updatedAt,
    createdAt: metadata.createdAt,
    contentHash: metadata.contentHash,
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
      fileName: '',
      fileSize: 0,
      fileType: '',
      updatedAt: 0,
      createdAt: 0,
      contentHash: '',
    }
  }
}

/// Checks for complete metadata, most importantly the presence of the contentHash.
export function hasCompleteMetadata(metadata: FileMetadata): boolean {
  return (
    !!metadata.contentHash &&
    !!metadata.fileType &&
    !!metadata.fileName &&
    !!metadata.fileSize &&
    !!metadata.updatedAt &&
    !!metadata.createdAt
  )
}
