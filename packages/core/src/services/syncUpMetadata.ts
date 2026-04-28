import { logger } from '@siastorage/logger'
import type { AppService, AppServiceInternal } from '../app/service'
import type { FileQueryOpts } from '../db/operations/files'
import {
  decodeFileMetadata,
  encodeFileMetadata,
  MAX_SUPPORTED_VERSION,
} from '../encoding/fileMetadata'
import { SlotPool } from '../lib/slotPool'
import { fileMetadataKeys } from '../types/files'

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
 *
 * Suspension signal policy: accepts AbortSignal. DB-holding loop —
 * reads remote metadata and writes local DB. Checks signal at exit
 * points so a mid-batch abort doesn't issue queries after the gate.
 */
export async function syncUpMetadataBatch(
  batchSize: number,
  concurrency: number,
  signal: AbortSignal,
  app: AppService,
  internal: AppServiceInternal,
): Promise<void> {
  if (!app.connection.getState().isConnected) {
    logger.debug('syncUpMetadata', 'skipped', { reason: 'not_connected' })
    app.sync.setState({ isSyncingUp: false })
    return
  }
  if (signal.aborted) return

  const sdk = internal.requireSdk()
  const indexerURL = await app.settings.getIndexerURL()
  const after = await app.sync.getSyncUpCursor()
  logger.debug('syncUpMetadata', 'tick', {
    fromId: after?.id ?? 'begin',
    afterUpdatedAt: after?.updatedAt,
  })
  const batch = await app.files.query({
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
    includeThumbnails: true,
    includeOldVersions: true,
    includeTrashed: true,
    includeDeleted: true,
  })
  if (batch.length === 0) {
    logger.debug('syncUpMetadata', 'no_updates')
    app.sync.setState({
      isSyncingUp: false,
      syncUpProcessed: 0,
      syncUpTotal: 0,
    })
    return
  }
  if (!app.sync.getState().isSyncingUp) {
    const queryOpts: FileQueryOpts = {
      order: 'ASC',
      orderBy: 'updatedAt',
      pinned: { indexerURL, isPinned: true },
      after: after ? { value: after.updatedAt, id: after.id } : undefined,
      includeThumbnails: true,
      includeOldVersions: true,
      includeTrashed: true,
      includeDeleted: true,
    }
    const total = await app.files.queryCount(queryOpts)
    app.sync.setState({
      isSyncingUp: true,
      syncUpProcessed: 0,
      syncUpTotal: total,
    })
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
          const result = await tryWithLog(() => sdk.deleteObject(obj.id), 'deleteObject', ctx)
          if (result === null) {
            hasErrors = true
            return
          }
          await app.localObjects.delete(obj.id, indexerURL)
          return
        }

        const remote = await tryWithLog(() => sdk.getPinnedObject(obj.id), 'getPinnedObject', ctx)
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
          const fileToEncode = await app.files.getMetadata(f.id)
          if (!fileToEncode) return
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
              return sdk.updateObjectMetadata(remote)
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
  const prevProcessed = app.sync.getState().syncUpProcessed ?? 0
  app.sync.setState({
    isSyncingUp: true,
    syncUpProcessed: prevProcessed + batch.length,
  })
  if (hasErrors) {
    logger.warn('syncUpMetadata', 'batch_had_errors_cursor_not_advanced')
    app.sync.setState({
      isSyncingUp: false,
      syncUpProcessed: 0,
      syncUpTotal: 0,
    })
    return
  }
  const last = batch[batch.length - 1]
  if (batch.length < batchSize) {
    app.sync.setState({
      isSyncingUp: false,
      syncUpProcessed: 0,
      syncUpTotal: 0,
    })
    await app.sync.setSyncUpCursor({
      updatedAt: last.updatedAt + 1,
      id: last.id,
    })
    logger.debug('syncUpMetadata', 'end_reached')
  } else {
    await app.sync.setSyncUpCursor({
      updatedAt: last.updatedAt,
      id: last.id,
    })
  }
}
