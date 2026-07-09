import type { DatabaseAdapter } from '../adapters/db'
import { deleteFsMeta, readFsMeta, updateFsMetaUsedAt, upsertFsMeta } from '../db/operations/fs'

const USED_AT_UPDATE_INTERVAL_MS = 60 * 60 * 1000 // 1 hour

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
   * path can't be reconstructed from id + mime type.
   */
  removeByPath?(path: string): Promise<void>
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
   * `sha256`, when present, is the full normalized `sha256:<lowercase hex>`
   * string; the adapter normalizes it and core never touches hash format.
   * Absent means the caller must hash the copy itself. `signal`/`onProgress`
   * are in-process-only and dropped over IPC (same policy as downloads).
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
  ): Promise<{ uri: string; size: number; sha256?: string; mime?: string }>
  writeFile?(
    file: { id: string; type: string },
    data: ArrayBuffer,
  ): Promise<{ uri: string; size: number }>
  adoptFile?(
    file: { id: string; type: string },
    sourceUri: string,
  ): Promise<{ uri: string; size: number; hash: string }>
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
   * Reports the device's usable free bytes and total. Optional: an adapter
   * that omits it reports `Number.MAX_SAFE_INTEGER` free, so callers gating
   * on space see ample room.
   */
  getDeviceSpace?(): Promise<{ freeBytes: number; totalBytes: number }>
}

export async function getFsFileUri(
  db: DatabaseAdapter,
  file: { id: string; type: string },
  adapter: FsFileUriAdapter,
  opts?: { usedAtUpdateInterval?: number },
): Promise<string | null> {
  const existingMeta = await readFsMeta(db, file.id)
  const { value: size, error } = await adapter.size(file.id, file.type)

  if (size === null) {
    if (error === 'not_found' && existingMeta) {
      await deleteFsMeta(db, file.id)
    }
    // On stat_error, preserve existing metadata so we don't lose
    // track of files that haven't been uploaded yet.
    return null
  }
  const now = Date.now()

  if (!existingMeta) {
    await upsertFsMeta(db, {
      fileId: file.id,
      size,
      addedAt: now,
      usedAt: now,
    })
  } else {
    const interval = opts?.usedAtUpdateInterval ?? USED_AT_UPDATE_INTERVAL_MS
    const timeSinceLastUse = now - existingMeta.usedAt
    if (timeSinceLastUse > interval) {
      await updateFsMetaUsedAt(db, file.id, now)
    }
  }

  return adapter.uri(file.id, file.type)
}
