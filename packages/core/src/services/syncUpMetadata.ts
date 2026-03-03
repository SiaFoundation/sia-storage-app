import { logger } from '@siastorage/logger'
import type { PinnedObjectRef } from '../adapters/sdk'
import {
  MAX_SUPPORTED_VERSION,
  type FileMetadata,
  decodeFileMetadata,
  encodeFileMetadata,
} from '../encoding/fileMetadata'
import { SlotPool } from '../lib/slotPool'
import type { FileRecord } from '../types/files'
import { fileMetadataKeys } from '../types/files'
import type { FileRecordsQueryOpts } from '../db/operations/files'

type DiffEntry = { local: unknown; remote: unknown }

export function diffFileMetadata(
  localMeta: Record<string, unknown>,
  remoteMeta: Record<string, unknown>,
): Record<string, DiffEntry> {
  const diffs: Record<string, DiffEntry> = {}
  for (const key of fileMetadataKeys) {
    const l = localMeta[key] ?? null
    const r = remoteMeta[key] ?? null
    if (l !== r) {
      diffs[key] = { local: l, remote: r }
    }
  }
  return diffs
}

export type SyncUpCursor = {
  updatedAt: number
  id: string
}

export type SyncUpProgressState = {
  isSyncing: boolean
  processed?: number
  total?: number
}

export type SyncUpDeps = {
  sdk: {
    getPinnedObject(objectId: string): Promise<PinnedObjectRef>
    updateObjectMetadata(pinnedObject: PinnedObjectRef): Promise<void>
    deleteObject(objectId: string): Promise<void>
  }
  files: {
    readAll(opts: FileRecordsQueryOpts): Promise<FileRecord[]>
    readAllCount(opts: FileRecordsQueryOpts): Promise<number>
  }
  localObjects: {
    delete(objectId: string, indexerURL: string): Promise<void>
    countForFile(fileId: string): Promise<number>
  }
  tags: {
    readNamesForFile(fileId: string): Promise<string[] | undefined>
  }
  directories: {
    readNameForFile(fileId: string): Promise<string | undefined>
  }
  platform: {
    isConnected(): boolean
    getIndexerURL(): Promise<string>
  }
  hooks: {
    onProgress(state: SyncUpProgressState): void
    getIsSyncing(): boolean
  }
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

/**
 * Iterate files pinned to the current indexer, fetch latest remote metadata,
 * diff against local file metadata, and if local is newer, push to remote.
 * This function processes files with updatedAt after the cursor, to pick
 * up any unsynced changes.
 *
 * TODO: Multi-indexer cleanup gap. Currently we only connect to one indexer
 * at a time, so this function only deletes objects for the current indexer.
 * If a file has objects on Indexer A and B, and gets tombstoned while
 * connected to A, only A's object is deleted. B's object row persists
 * locally. Switching to B won't help because the syncUp cursor (which is
 * global, not per-indexer) has already advanced past the file. A future
 * cleanup service should scan for tombstoned files that still have object
 * rows on non-current indexers. Alternatively, the cursor could be reset
 * or stored per-indexer when multi-indexer support is added.
 */
export async function runSyncUpMetadataBatch(
  batchSize: number,
  concurrency: number,
  signal: AbortSignal,
  deps: SyncUpDeps,
  getCursor: () => Promise<SyncUpCursor | undefined>,
  setCursor: (cursor: SyncUpCursor | undefined) => Promise<void>,
): Promise<void> {
  if (!deps.platform.isConnected()) {
    logger.debug('syncUpMetadata', 'skipped', { reason: 'not_connected' })
    deps.hooks.onProgress({ isSyncing: false })
    return
  }
  if (signal.aborted) return
  const indexerURL = await deps.platform.getIndexerURL()
  const after = await getCursor()
  logger.debug('syncUpMetadata', 'tick', {
    fromId: after?.id ?? 'begin',
    afterUpdatedAt: after?.updatedAt,
  })
  const batch = await deps.files.readAll({
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
    deps.hooks.onProgress({ isSyncing: false, processed: 0, total: 0 })
    return
  }
  if (!deps.hooks.getIsSyncing()) {
    const queryOpts: FileRecordsQueryOpts = {
      order: 'ASC',
      orderBy: 'updatedAt',
      pinned: { indexerURL, isPinned: true },
      after: after ? { value: after.updatedAt, id: after.id } : undefined,
    }
    const total = await deps.files.readAllCount(queryOpts)
    deps.hooks.onProgress({ isSyncing: true, processed: 0, total })
  }
  let hasErrors = false
  const pool = new SlotPool(concurrency)
  await Promise.all(
    batch.map((f) => {
      const obj = f.objects[indexerURL]
      if (!obj || !obj.id) return
      return pool.withSlot(async () => {
        if (signal.aborted) return
        const ctx = { fileId: f.id, objectId: obj.id, fileName: f.name }

        // Tombstoned files: delete the remote object and clean up the
        // local object row. The file row itself is never removed — the
        // tombstone is the permanent record of deletion, required for
        // convergence across devices in our event-log sync model.
        //
        // This only deletes the object for the currently connected
        // indexer. If the file has objects on other indexers, those
        // object rows persist locally until the user connects to that
        // indexer. See TODO below about the cleanup gap.
        //
        // If deleteObject fails, we must NOT clean up the local object
        // row — we'd lose the reference to the remote object and could
        // never retry. The batch stalls and retries on the next tick.
        if (f.deletedAt) {
          const result = await tryWithLog(
            () => deps.sdk.deleteObject(obj.id),
            'deleteObject',
            ctx,
          )
          if (result === null) {
            hasErrors = true
            return
          }
          await deps.localObjects.delete(obj.id, indexerURL)
          return
        }

        const remote = await tryWithLog(
          () => deps.sdk.getPinnedObject(obj.id),
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
          let fileToEncode: FileMetadata = f
          if (f.kind === 'file') {
            const tags = await deps.tags.readNamesForFile(f.id)
            if (tags) {
              fileToEncode = { ...fileToEncode, tags }
            }
            const directory = await deps.directories.readNameForFile(f.id)
            if (directory) {
              fileToEncode = { ...fileToEncode, directory }
            }
          }
          logger.info('syncUpMetadata', 'pushing_v1', {
            fileId: fileToEncode.id,
            objectId: obj.id,
            kind: fileToEncode.kind,
            thumbForId: fileToEncode.thumbForId,
            thumbSize: fileToEncode.thumbSize,
          })
          const result = await tryWithLog(
            () => {
              remote.updateMetadata(encodeFileMetadata(fileToEncode))
              return deps.sdk.updateObjectMetadata(remote)
            },
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
  deps.hooks.onProgress({ isSyncing: true, processed: batch.length })
  if (hasErrors) {
    logger.warn('syncUpMetadata', 'batch_had_errors_cursor_not_advanced')
    deps.hooks.onProgress({ isSyncing: false, processed: 0, total: 0 })
    return
  }
  const last = batch[batch.length - 1]
  if (batch.length < batchSize) {
    deps.hooks.onProgress({ isSyncing: false, processed: 0, total: 0 })
    await setCursor({
      updatedAt: last.updatedAt + 1,
      id: last.id,
    })
    logger.debug('syncUpMetadata', 'end_reached')
  } else {
    await setCursor({
      updatedAt: last.updatedAt,
      id: last.id,
    })
  }
}
