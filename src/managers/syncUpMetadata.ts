import { z } from 'zod'
import {
  SYNC_UP_METADATA_BATCH_SIZE,
  SYNC_UP_METADATA_INTERVAL,
} from '../config'
import {
  decodeFileMetadata,
  encodeFileMetadata,
} from '../encoding/fileMetadata'
import { logger } from '../lib/logger'
import { createServiceInterval } from '../lib/serviceInterval'
import { getAsyncStorageJSON, setAsyncStorageJSON } from '../stores/asyncStore'
import {
  type FileMetadata,
  fileMetadataKeys,
  readAllFileRecords,
} from '../stores/files'
import { getIsConnected, getPinnedObject, updateMetadata } from '../stores/sdk'
import { getIndexerURL } from '../stores/settings'

type DiffEntry = { local: unknown; remote: unknown }
type DiffResult = Record<keyof FileMetadata, DiffEntry>

export function diffFileMetadata(
  localMeta: FileMetadata,
  remoteMeta: FileMetadata,
): Partial<DiffResult> {
  const diffs: Partial<DiffResult> = {}
  for (const key of fileMetadataKeys) {
    const l = localMeta[key]
    const r = remoteMeta[key]
    if (l !== r) {
      diffs[key] = { local: l, remote: r }
    }
  }
  return diffs
}

export type MetadataSyncResult = {
  scanned: number
  withDiffs: number
  updatedRemote: number
  skipped: number
  failed: number
}

type LogContext = { fileId: string; objectId: string; fileName: string }

async function tryWithLog<T>(
  fn: () => T | Promise<T>,
  operation: string,
  ctx: LogContext,
): Promise<T | null> {
  try {
    return await fn()
  } catch (e) {
    logger.error('syncUpMetadata', `${operation}_failed`, {
      ...ctx,
      error: e as Error,
    })
    return null
  }
}

// Persistent cursor saved for next batch.
const syncUpCursorCodec = z.codec(
  z.object({
    updatedAt: z.number(),
    id: z.string(),
  }),
  z.object({
    updatedAt: z.number(),
    id: z.string(),
  }),
  {
    decode: (stored) => stored,
    encode: (domain) => domain,
  },
)

type SyncUpCursor = {
  updatedAt: number
  id: string
}

export async function getSyncUpCursor(): Promise<SyncUpCursor | undefined> {
  return getAsyncStorageJSON('syncUpCursor', syncUpCursorCodec)
}

export async function setSyncUpCursor(
  value: SyncUpCursor | undefined,
): Promise<void> {
  await setAsyncStorageJSON('syncUpCursor', value, syncUpCursorCodec)
}

/**
 * Iterate files pinned to the current indexer, fetch latest remote metadata,
 * diff against local file metadata, and if local is newer, push to remote.
 * This function processes files with updatedAt after the cursor, to pick
 * up any unsynced changes.
 */
export async function runSyncUpMetadata(batchSize: number): Promise<void> {
  if (!getIsConnected()) {
    logger.debug('syncUpMetadata', 'skipped', { reason: 'not_connected' })
    return
  }
  const indexerURL = await getIndexerURL()
  const after = await getSyncUpCursor()
  logger.debug('syncUpMetadata', 'tick', {
    fromId: after?.id ?? 'begin',
    afterUpdatedAt: after?.updatedAt,
  })
  const batch = await readAllFileRecords({
    order: 'ASC',
    orderBy: 'updatedAt',
    pinned: { indexerURL, isPinned: true },
    limit: batchSize,
    after: after
      ? {
          value: after.updatedAt,
          id: after.id,
        }
      : undefined,
  })
  if (batch.length === 0) {
    logger.debug('syncUpMetadata', 'no_updates')
    return
  }
  for (const f of batch) {
    const obj = f.objects[indexerURL]
    if (!obj || !obj.id) continue

    const ctx = { fileId: f.id, objectId: obj.id, fileName: f.name }

    const remote = await tryWithLog(
      () => getPinnedObject(obj.id),
      'getPinnedObject',
      ctx,
    )
    if (!remote) continue

    const remoteMeta = await tryWithLog(
      () => decodeFileMetadata(remote.metadata()),
      'decodeFileMetadata',
      ctx,
    )
    if (!remoteMeta) continue

    const diffs = diffFileMetadata(f, remoteMeta)
    if (Object.keys(diffs).length === 0) continue

    const isLocalNewer = (f.updatedAt || 0) >= (remoteMeta.updatedAt || 0)
    logger.info('syncUpMetadata', 'metadata_diff', {
      fileId: f.id,
      objectId: obj.id,
      localUpdatedAt: f.updatedAt,
      remoteUpdatedAt: remoteMeta.updatedAt,
      newerSide: isLocalNewer ? 'local' : 'remote',
      diffs,
    })

    if (isLocalNewer) {
      await tryWithLog(
        () => updateMetadata(remote, encodeFileMetadata(f)),
        'updateMetadata',
        ctx,
      )
    }
  }
  const last = batch[batch.length - 1]
  if (batch.length < batchSize) {
    await setSyncUpCursor({
      updatedAt: last.updatedAt + 1,
      id: last.id,
    })
    logger.debug('syncUpMetadata', 'end_reached')
  } else {
    await setSyncUpCursor({
      updatedAt: last.updatedAt,
      id: last.id,
    })
  }
}

export const initSyncUpMetadata = createServiceInterval({
  name: 'syncUpMetadata',
  worker: async () => {
    return runSyncUpMetadata(SYNC_UP_METADATA_BATCH_SIZE)
  },
  getState: async () => true,
  interval: SYNC_UP_METADATA_INTERVAL,
})
