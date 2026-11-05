import { logger } from '@siastorage/logger'
import type { DatabaseAdapter } from '../adapters/db'
import { USED_AT_UPDATE_INTERVAL } from '../config'
import {
  deleteFsMeta,
  insertFsMetaIfAbsent,
  readFsMeta,
  updateFsMetaUsedAt,
  upsertFsMeta,
} from '../db/operations/fs'
import type { ContentHash } from '../lib/contentHash'

/**
 * What a claim-scoped copy produced, by how it ran. `stream` read arbitrary
 * bytes (headerBytes feeds the type classifier; absent for an empty file);
 * `asset` copied a photo-library resource (mediaMime is its OS-reported
 * type); `plain` moved or copied without hashing, so the caller hashes and
 * classifies from the local file. An IPC transport must base64 `headerBytes`.
 */
export type ImportCopyResult =
  | { kind: 'stream'; uri: string; size: number; sha256: ContentHash; headerBytes?: Uint8Array }
  | { kind: 'asset'; uri: string; size: number; sha256: ContentHash; mediaMime: string }
  | { kind: 'plain'; uri: string; size: number }

/**
 * What `adoptFile` produced when it hashed the file (the default): the
 * `sha256:<hex>` string callers write to the file record.
 */
export type AdoptFileHashed = { uri: string; size: number; hash: ContentHash }

/** What `adoptFile` produced with `{ hash: false }`: size only, no hash. */
export type AdoptFilePlain = { uri: string; size: number }

export type SizeResult =
  | { value: number; error?: undefined }
  | { value: null; error: 'not_found' | 'stat_error' }

export type FsFileUriAdapter = {
  uri(fileId: string, type: string): string
  size(fileId: string, type: string): Promise<SizeResult>
}

export type FsIOAdapter = FsFileUriAdapter & {
  remove(fileId: string, type: string): Promise<void>
  /**
   * Delete a file by its literal path (as returned by `list()`). Used by the
   * orphan scanner to sweep claim-scoped temp files `<id>.<token>.tmp`, whose
   * path can't be reconstructed from id + mime type. Returns the bytes
   * removed, 0 when nothing was there.
   */
  removeByPath?(path: string): Promise<number>
  /** Plain byte copy into the file's slot. */
  copy(
    file: { id: string; type: string },
    sourceUri: string,
  ): Promise<{ uri: string; size: number }>
  /**
   * The import scanner's copy. Adapters whose copies can race a reclaimed
   * claim (mobile) land each copy in a per-claim temp so the id slot never
   * has two concurrent writers; the single-process node adapter writes the
   * slot directly.
   * `sha256` is the full normalized `sha256:<lowercase hex>` string on the
   * hashing arms; the adapter normalizes it and core never touches hash
   * format. `signal`/`onProgress` are in-process-only and dropped over IPC
   * (same policy as downloads).
   */
  importCopy(
    file: { id: string; type: string },
    sourceUri: string,
    opts: {
      claimToken: string
      signal?: AbortSignal
      onProgress?: (bytesCopied: number, totalBytes: number | null) => void
      /** Consume the source by rename (one byte-write) instead of copying;
       * only ever set for app-owned `staged` temps. */
      move?: boolean
    },
  ): Promise<ImportCopyResult>
  writeFile?(
    file: { id: string; type: string },
    data: ArrayBuffer,
  ): Promise<{ uri: string; size: number }>
  /**
   * Reads a managed file's bytes into memory. Optional: only a host that
   * hands small files such as thumbnails to another process inline needs it,
   * and nothing large should go through it.
   */
  readFile?(file: { id: string; type: string }): Promise<Uint8Array>
  /**
   * Places a managed file's bytes at an absolute path outside managed storage
   * and returns the byte count. Hardlinks when both sides share a volume and
   * falls back to a copy, so a large file is never held in memory.
   *
   * Optional: only a host that hands bytes to another process by path needs it.
   */
  exportTo?(file: { id: string; type: string }, destPath: string): Promise<number>
  /**
   * Take ownership of a source file by renaming it into the file's slot,
   * consuming the source. Hashes the result by default, returning the
   * `sha256:<hex>` string; the download path passes `hash: false` to skip the
   * extra full read (size only), because it already knows the size and never
   * reads a hash back. Optional: only a host that takes ownership of a file by
   * path implements it.
   */
  adoptFile?(file: { id: string; type: string }, sourceUri: string): Promise<AdoptFileHashed>
  adoptFile?(
    file: { id: string; type: string },
    sourceUri: string,
    opts: { hash: false },
  ): Promise<AdoptFilePlain>
  /**
   * Move a file's on-disk path to match a new mime type. No-op when
   * extensions match. **Overwrites** any existing file at the destination
   * — callers must ensure the destination is safe to replace. The
   * scanner's self-heal path guarantees this because the destination is
   * derived from file ID + new type, which only collides for files being
   * explicitly corrected.
   */
  renameToType(file: { id: string; type: string }, newType: string): Promise<{ uri: string }>
  list(): Promise<string[]>
  ensureDirectory(): Promise<void>
  /**
   * Reports the device's usable free bytes. Optional: an adapter that omits it
   * reports `Number.MAX_SAFE_INTEGER`, so callers gating on space see ample room.
   */
  getDeviceSpace?(): Promise<{ freeBytes: number }>
}

/**
 * Resolves a file's local copy, or null when its bytes are not on disk. It
 * drops the `fs` row when the bytes are gone and rebuilds it when bytes exist
 * without one.
 *
 * A read counts as a use, and moves `usedAt`, the clock cache eviction ages
 * copies by, only with `recordUse: true`, which reads the user asks for pass:
 * opening, sharing or saving a file, a Finder open, a CLI download. Most reads
 * are the app's own, such as the uploader, the thumbnail generator and the
 * library's tiles. Counting those would mark every freshly imported copy as
 * just used, and the eviction pass skips anything used within its minimum
 * age, so a large import would keep every uploaded copy on disk until the
 * device runs out of space. A row rebuilt by such a read gets `usedAt` 0, the
 * value the importer writes.
 */
export async function getFsFileUri(
  db: DatabaseAdapter,
  file: { id: string; type: string },
  adapter: FsFileUriAdapter,
  opts?: { usedAtUpdateInterval?: number; recordUse?: boolean },
): Promise<string | null> {
  const existingMeta = await readFsMeta(db, file.id)
  const { value: size, error } = await adapter.size(file.id, file.type)

  if (size === null) {
    if (error === 'not_found' && existingMeta) {
      // No bytes at the path the file's type names, so dropping the record
      // makes the file read as remote-only. The bytes can still sit at a
      // stale extension, which the orphan scanner moves back and records.
      logger.warn('fsFileUri', 'local_copy_missing', { fileId: file.id, type: file.type })
      await deleteFsMeta(db, file.id)
    }
    // On stat_error, preserve existing metadata so we don't lose
    // track of files that haven't been uploaded yet.
    return null
  }
  const now = Date.now()
  const recordUse = opts?.recordUse ?? false

  if (!existingMeta && recordUse) {
    await upsertFsMeta(db, { fileId: file.id, size, addedAt: now, usedAt: now })
  } else if (!existingMeta) {
    // A user's read of the same file may have recorded a row while this one
    // waited on the size, and replacing it would reset its use time to 0.
    await insertFsMetaIfAbsent(db, { fileId: file.id, size, addedAt: now, usedAt: 0 })
  } else if (recordUse) {
    const interval = opts?.usedAtUpdateInterval ?? USED_AT_UPDATE_INTERVAL
    const timeSinceLastUse = now - existingMeta.usedAt
    if (timeSinceLastUse > interval) {
      await updateFsMetaUsedAt(db, file.id, now)
    }
  }

  return adapter.uri(file.id, file.type)
}
