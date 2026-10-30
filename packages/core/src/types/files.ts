import type { LocalObjectRef } from '../encoding/localObject'
import type { ContentHash } from '../lib/contentHash'
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
  /**
   * Empty when no hash is known: metadata published without one, or a shared
   * file previewed before it is hashed.
   */
  hash: ContentHash | ''
  thumbForId?: string
  thumbSize?: ThumbSize
  tags?: string[]
  /** The folder path the file is in, or for a trashed file the one it was trashed from. '' is the root. */
  directory?: string
  trashedAt: number | null
  /** For a trashed file, the path of the deleted folder it went to the trash with. */
  trashedFolder?: string
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

// tags, directory and trashedFolder are synced via object metadata but stored
// apart from these columns locally: tags and the folder in their own tables,
// and a trashed file's folder and deleted folder in trashedFrom and
// trashedFolder, which file reads leave out.
export const fileMetadataKeys = keysOf<
  Omit<FileMetadata, 'tags' | 'directory' | 'trashedFolder'>
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

export type FileRecordRow = Omit<FileMetadata, 'tags' | 'directory' | 'trashedFolder'> &
  FileLocalMetadata

export const fileRecordRowKeys = keysOf<Omit<FileRecordRow, 'tags'>>()([
  ...fileMetadataKeys,
  ...fileLocalMetadataKeys,
])

/**
 * How a write moves the file's version clock: 'now' stamps a local edit, a number carries the
 * timestamp of a change made elsewhere, 'preserve' leaves the clock where it is for a correction
 * that changes nothing the user did, and 'bump' sets max(now, current + 1) in SQL so the new
 * value outranks the row even under a concurrent write.
 */
export type UpdatedAtWrite = 'now' | 'preserve' | 'bump' | number

/**
 * Fields a write may set. updatedAt is absent because UpdatedAtWrite decides
 * it, and hash because a row's bytes never change: its objects on the indexer
 * cannot. New bytes are a new version row (`files.addVersion`).
 */
export type FileUpdate = Omit<Partial<FileRecordRow>, 'updatedAt' | 'hash'> & { id: string }

export type FileRecord = FileRecordRow & {
  objects: Record<string, LocalObjectRef>
}

/**
 * A file in the trash with the versions trashed along with it. `id` is the
 * newest of them, and names the entry to restore or delete it.
 */
export type TrashEntry = {
  id: string
  /** `folder` is a deleted folder, which holds every file the delete took into the trash. */
  kind: 'file' | 'folder'
  /** The file's name, or the deleted folder's. */
  name: string
  /** The file's type, '' for a folder. */
  type: string
  /** The file's size, or for a folder the size of every file in it. */
  size: number
  /**
   * The folder path it restores into, null for the top of the library. Restore
   * creates it again if it no longer exists.
   */
  folder: string | null
  versions: number
  /** How many files a folder holds, 1 for a file. */
  files: number
  trashedAt: number
  /** The earliest the trash deletes it for good. The hourly purge may run later. */
  purgeAt: number
}

/** A file brought back from the trash, under the name it came back with. */
export type RestoredFile = {
  /** The newest restored version. */
  id: string
  name: string
  /** The name it was trashed under, when a live file had taken it since. */
  renamedFrom: string | null
}
