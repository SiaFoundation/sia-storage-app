import { logger } from '../lib/logger'

export type FileMetadata = {
  id: string
  name?: string
  fileType?: string
  size?: number
}

export function encodeFileMetadata(params: FileMetadata): ArrayBuffer {
  return new TextEncoder().encode(
    JSON.stringify({
      id: params.id,
      name: params.name,
      fileType: params.fileType,
      size: params.size,
    })
  ).buffer as ArrayBuffer
}

export function decodeFileMetadata(buffer?: ArrayBuffer): FileMetadata {
  try {
    return JSON.parse(new TextDecoder().decode(buffer)) as FileMetadata
  } catch (e) {
    logger.log('Error converting file metadata from buffer', e)
    return { id: '' }
  }
}
