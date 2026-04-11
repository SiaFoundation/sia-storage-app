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
  copy(
    file: { id: string; type: string },
    sourceUri: string,
  ): Promise<{ uri: string; size: number }>
  writeFile?(
    file: { id: string; type: string },
    data: ArrayBuffer,
  ): Promise<{ uri: string; size: number }>
  list(): Promise<string[]>
  ensureDirectory(): Promise<void>
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
