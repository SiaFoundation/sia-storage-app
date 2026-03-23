import type { LocalObject } from '../encoding/localObject'
import { keysOf } from '../lib/types'

/** Valid thumbnail sizes in pixels. */
export type ThumbSize = 64 | 512
export const ThumbSizes: ThumbSize[] = [64, 512]

export type FileKind = 'file' | 'thumb'

/** Fields that are stored in both the local database and the indexer metadata. */
export type FileMetadata = {
  id: string
  name: string
  type: string
  kind: FileKind
  size: number
  hash: string
  thumbForId?: string
  thumbSize?: ThumbSize
  tags?: string[]
  directory?: string
  trashedAt: number | null
  createdAt: number
  updatedAt: number
}

// tags and directory are synced via object metadata but stored in separate
// tables locally, not in the files table.
export const fileMetadataKeys = keysOf<
  Omit<FileMetadata, 'tags' | 'directory'>
>()([
  'id',
  'name',
  'type',
  'kind',
  'size',
  'hash',
  'createdAt',
  'updatedAt',
  'thumbForId',
  'thumbSize',
  'trashedAt',
])

/** Fields that are stored only in the local database. */
export type FileLocalMetadata = {
  localId: string | null
  addedAt: number
  deletedAt: number | null
  lostReason?: string | null
}

export const fileLocalMetadataKeys = keysOf<FileLocalMetadata>()([
  'localId',
  'addedAt',
  'deletedAt',
  'lostReason',
])

export type FileRecordRow = Omit<FileMetadata, 'tags' | 'directory'> &
  FileLocalMetadata

export const fileRecordRowKeys = keysOf<Omit<FileRecordRow, 'tags'>>()([
  ...fileMetadataKeys,
  ...fileLocalMetadataKeys,
])

export type FileRecord = FileRecordRow & {
  objects: Record<string, LocalObject>
}
