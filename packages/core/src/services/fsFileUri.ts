import type { DatabaseAdapter } from '../adapters/db'
import {
  deleteFsFileMetadata,
  readFsFileMetadata,
  updateFsFileMetadataUsedAt,
  upsertFsFileMetadata,
} from '../db/operations/fs'

const USED_AT_UPDATE_INTERVAL_MS = 60 * 60 * 1000 // 1 hour

export type FsFileUriAdapter = {
  exists(fileId: string, type: string): Promise<boolean>
  uri(fileId: string, type: string): string
  size(fileId: string, type: string): Promise<number | null>
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
  const existingMeta = await readFsFileMetadata(db, file.id)
  const fileExists = await adapter.exists(file.id, file.type)

  if (!fileExists) {
    if (existingMeta) {
      await deleteFsFileMetadata(db, file.id)
    }
    return null
  }

  const size =
    (await adapter.size(file.id, file.type)) ?? existingMeta?.size ?? 0
  const now = Date.now()

  if (!existingMeta) {
    await upsertFsFileMetadata(db, {
      fileId: file.id,
      size,
      addedAt: now,
      usedAt: now,
    })
  } else {
    const interval = opts?.usedAtUpdateInterval ?? USED_AT_UPDATE_INTERVAL_MS
    const timeSinceLastUse = now - existingMeta.usedAt
    if (timeSinceLastUse > interval) {
      await updateFsFileMetadataUsedAt(db, file.id, now)
    }
  }

  return adapter.uri(file.id, file.type)
}
