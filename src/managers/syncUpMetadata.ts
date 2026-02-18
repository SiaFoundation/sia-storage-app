import { z } from 'zod'
import {
  SYNC_UP_METADATA_BATCH_SIZE,
  SYNC_UP_METADATA_CONCURRENCY,
  SYNC_UP_METADATA_INTERVAL,
} from '../config'
import {
  decodeFileMetadata,
  encodeFileMetadata,
  MAX_SUPPORTED_VERSION,
} from '../encoding/fileMetadata'
import { logger } from '../lib/logger'
import { createServiceInterval } from '../lib/serviceInterval'
import { SlotPool } from '../lib/slotPool'
import { getAsyncStorageJSON, setAsyncStorageJSON } from '../stores/asyncStore'
import {
  fileMetadataKeys,
  readAllFileRecords,
  readAllFileRecordsCount,
} from '../stores/files'
import { getIsConnected, getPinnedObject, updateMetadata } from '../stores/sdk'
import { getIndexerURL } from '../stores/settings'
import {
  getIsSyncingUpMetadata,
  setSyncUpMetadataState,
} from '../stores/syncUpMetadata'

type DiffEntry = { local: unknown; remote: unknown }

export function diffFileMetadata(
  localMeta: Record<string, unknown>,
  remoteMeta: Record<string, unknown>,
): Record<string, DiffEntry> {
  const diffs: Record<string, DiffEntry> = {}
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

export async function resetSyncUpCursor(): Promise<void> {
  await setSyncUpCursor(undefined)
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
    setSyncUpMetadataState({ isSyncing: false })
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
    setSyncUpMetadataState({ isSyncing: false, processed: 0, total: 0 })
    return
  }
  if (!getIsSyncingUpMetadata()) {
    const queryOpts = {
      order: 'ASC' as const,
      orderBy: 'updatedAt' as const,
      pinned: { indexerURL, isPinned: true },
      after: after ? { value: after.updatedAt, id: after.id } : undefined,
    }
    const total = await readAllFileRecordsCount(queryOpts)
    setSyncUpMetadataState({ isSyncing: true, processed: 0, total })
  }
  let hasErrors = false
  const pool = new SlotPool(SYNC_UP_METADATA_CONCURRENCY)
  await Promise.all(
    batch.map((f) => {
      const obj = f.objects[indexerURL]
      if (!obj || !obj.id) return
      if (f.kind === 'thumb' && !f.thumbForId) return
      return pool.withSlot(async () => {
        const ctx = { fileId: f.id, objectId: obj.id, fileName: f.name }

        const remote = await tryWithLog(
          () => getPinnedObject(obj.id),
          'getPinnedObject',
          ctx,
        )
        if (!remote) {
          hasErrors = true
          return
        }

        const remoteMeta = await tryWithLog(
          () => decodeFileMetadata(remote.metadata()),
          'decodeFileMetadata',
          ctx,
        )
        if (!remoteMeta) {
          hasErrors = true
          return
        }

        let remoteVersion = 0
        try {
          const raw = JSON.parse(new TextDecoder().decode(remote.metadata()))
          remoteVersion = typeof raw.version === 'number' ? raw.version : 0
        } catch {
          // Ignore parse errors — remoteMeta decode already handles this.
        }
        if (remoteVersion > MAX_SUPPORTED_VERSION) {
          logger.warn('syncUpMetadata', 'skipping_newer_version', {
            ...ctx,
            remoteVersion,
            maxSupported: MAX_SUPPORTED_VERSION,
          })
          return
        }

        const diffs = diffFileMetadata(f, remoteMeta)
        // v0→v1 compat: Don't overwrite a remote ID that was already set by
        // another device. First device to push sets the canonical ID; others
        // adopt it via syncDown. Can be removed once all devices run v1.
        if (remoteMeta.id && diffs.id) {
          delete diffs.id
        }
        if (Object.keys(diffs).length === 0) return

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
          const fileToEncode =
            remoteMeta.id && remoteMeta.id !== f.id
              ? { ...f, id: remoteMeta.id }
              : f
          logger.info('syncUpMetadata', 'pushing_v1', {
            fileId: fileToEncode.id,
            objectId: obj.id,
            kind: fileToEncode.kind,
            thumbForId: fileToEncode.thumbForId,
            thumbForHash: remoteMeta.thumbForHash,
            thumbSize: fileToEncode.thumbSize,
          })
          const result = await tryWithLog(
            () =>
              updateMetadata(
                remote,
                encodeFileMetadata(fileToEncode, {
                  thumbForHash: remoteMeta.thumbForHash,
                }),
              ),
            'updateMetadata',
            ctx,
          )
          if (result === null) {
            hasErrors = true
            return
          }
        }
      })
    }),
  )
  setSyncUpMetadataState((s) => ({
    processed: s.processed + batch.length,
  }))
  if (hasErrors) {
    logger.warn('syncUpMetadata', 'batch_had_errors_cursor_not_advanced')
    setSyncUpMetadataState({ isSyncing: false, processed: 0, total: 0 })
    return
  }
  const last = batch[batch.length - 1]
  if (batch.length < batchSize) {
    setSyncUpMetadataState({ isSyncing: false, processed: 0, total: 0 })
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

export const { init: initSyncUpMetadata } = createServiceInterval({
  name: 'syncUpMetadata',
  worker: async () => {
    return runSyncUpMetadata(SYNC_UP_METADATA_BATCH_SIZE)
  },
  getState: async () => true,
  interval: SYNC_UP_METADATA_INTERVAL,
})
