import type { LocalObjectRef } from '../encoding/localObject'
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
  /**
   * The version clock, not a row-write timestamp. It orders the versions of a name to pick the
   * current one, and decides remote-versus-local wins during sync, so it advances only when a
   * device changes something: applying a remote change carries that device's value, and
   * correcting a stored field to match what was observed carries none. A correction leaves the
   * clock behind remote, so sync-up skips pushing it; that only holds for a field every device
   * can observe for itself, which is why size is the one field corrected this way.
   */
  updatedAt: number
}

// tags and directory are synced via object metadata but stored in separate
// tables locally, not in the files table.
export const fileMetadataKeys = keysOf<Omit<FileMetadata, 'tags' | 'directory'>>()([
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
  mediaAssetId: string | null
  addedAt: number
  deletedAt: number | null
  lostReason?: string | null
}

export const fileLocalMetadataKeys = keysOf<FileLocalMetadata>()([
  'mediaAssetId',
  'addedAt',
  'deletedAt',
  'lostReason',
])

export type FileRecordRow = Omit<FileMetadata, 'tags' | 'directory'> & FileLocalMetadata

export const fileRecordRowKeys = keysOf<Omit<FileRecordRow, 'tags'>>()([
  ...fileMetadataKeys,
  ...fileLocalMetadataKeys,
])

/**
 * How a write moves the file's version clock: 'now' stamps a local edit, a number carries the
 * timestamp of a change made elsewhere, and 'preserve' leaves the clock where it is for a
 * correction that changes nothing the user did.
 */
export type UpdatedAtWrite = 'now' | 'preserve' | number

/** Fields a write may set. updatedAt is absent because UpdatedAtWrite decides it. */
export type FileUpdate = Omit<Partial<FileRecordRow>, 'updatedAt'> & { id: string }

export type FileRecord = FileRecordRow & {
  objects: Record<string, LocalObjectRef>
}
