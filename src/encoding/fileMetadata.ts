import { logger } from '../lib/logger'
import { FileRecordRow } from '../stores/files'

type LegacyFileMetadata = {
  name?: string
  size?: number
}

export type FileMetadata = FileRecordRow & LegacyFileMetadata

export function transformFileMetadata(
  metadata: FileRecordRow & LegacyFileMetadata
): FileRecordRow {
  const now = new Date().getTime()
  return {
    id: metadata.id,
    fileName: metadata.fileName ?? metadata.name ?? '',
    fileType: metadata.fileType,
    fileSize: metadata.fileSize ?? metadata.size ?? 0,
    updatedAt: metadata.updatedAt ?? now,
    createdAt: metadata.createdAt ?? now,
    localId: metadata.localId,
    contentHash: metadata.contentHash,
  }
}

export function encodeFileMetadata(
  params: Required<FileRecordRow> & LegacyFileMetadata
): ArrayBuffer {
  return new TextEncoder().encode(JSON.stringify(transformFileMetadata(params)))
    .buffer as ArrayBuffer
}

export function decodeFileMetadata(buffer?: ArrayBuffer): FileRecordRow {
  try {
    return transformFileMetadata(JSON.parse(new TextDecoder().decode(buffer)))
  } catch (e) {
    logger.log('Error converting file metadata from buffer', e)
    return {
      id: '',
      fileName: '',
      fileSize: 0,
      fileType: '',
      updatedAt: 0,
      createdAt: 0,
      localId: null,
      contentHash: null,
    }
  }
}
