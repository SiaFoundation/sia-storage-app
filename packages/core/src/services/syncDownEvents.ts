import { logger } from '@siastorage/logger'
import type { PinnedObjectRef } from '../adapters/sdk'
import type { AppService, AppServiceInternal } from '../app/service'
import type { SyncGateStatus } from '../app/stores'
import { SYNC_GATE_CREATE_THRESHOLD, SYNC_GATE_HYDRATION_MIN } from '../config'
import {
  decodeFileMetadata,
  hasCompleteFileMetadata,
  hasCompleteThumbnailMetadata,
} from '../encoding/fileMetadata'
import type { LocalObject } from '../encoding/localObject'
import { sealPinnedObject } from '../lib/localObjects'
import type { FileMetadata, FileRecordRow } from '../types/files'

/**
 * Activates the sync gate if auto-sync is enabled and connected.
 * Call before starting the sync service on any platform.
 */
export async function activateSyncGate(app: AppService): Promise<void> {
  const autoSync = await app.settings.getAutoSyncDownEvents()
  const isConnected = app.connection.getState().isConnected
  if (autoSync && isConnected) {
    app.sync.setState({ syncGateStatus: 'pending' })
  }
}

const batchSize = 500

type Counts = {
  total: number
  // New files only (thumbnails excluded); a metadata-repair wave is updates,
  // so this stays low.
  fileCreates: number
}

/**
 * Gate status for a just-classified batch. Keyed on new files, not event count,
 * so a catch-up that's only metadata repairs doesn't block a returning user.
 * Latches once it leaves 'pending':
 *   - established library: decided on the first batch
 *   - near-empty library: keep holding while few new files have arrived
 */
function nextGateStatus(
  current: SyncGateStatus,
  fileCreates: number,
  hydrating: boolean,
): SyncGateStatus {
  if (current !== 'pending') return current
  if (fileCreates >= SYNC_GATE_CREATE_THRESHOLD) return 'active'
  return hydrating ? 'pending' : 'dismissed'
}

// A "create" means no existing file record matches this object.
type PreparedCreate = {
  kind: 'create'
  fileRecord: FileRecordRow
  localObject: LocalObject
  tags?: string[]
  directory?: string
  isFile: boolean
}

// An "update" means a file record already exists; merge metadata fields.
type PreparedUpdate = {
  kind: 'update'
  fileRecord: FileRecordRow
  localObject: LocalObject
  fileId: string
  tags?: string[]
  directory?: string
  isFile: boolean
  isRemoteNewer: boolean
}

// A "delete" means the object was removed from the indexer.
type PreparedDelete = {
  kind: 'delete'
  objectId: string
  fileId: string
  fileRecord: FileRecordRow
  indexerURL: string
}

type PreparedEvent = PreparedCreate | PreparedUpdate | PreparedDelete

/**
 * Syncs down events from the indexer to the local database. It starts from the
 * sync-DOWN cursor (persisted via the storage adapter; unrelated to the removed
 * sync-up cursor), iterates until there are no more events, and persists the
 * cursor after each batch. Runs again every SYNC_EVENTS_INTERVAL milliseconds.
 *
 * Returns 0 when multiple events were fetched (run again immediately),
 * or void to use the default interval.
 *
 * Suspension signal policy: accepts AbortSignal. DB-holding loop —
 * fetches event batches from the indexer and writes objects to the
 * local DB in a transaction. Checks signal at every exit point so a
 * mid-batch abort releases the transaction before the DB gate closes.
 */
export async function syncDownEventsBatch(
  signal: AbortSignal,
  app: AppService,
  internal: AppServiceInternal,
): Promise<number | void> {
  logger.debug('syncDownEvents', 'tick')

  const sdk = internal.requireSdk()

  const counts: Counts = { total: 0, fileCreates: 0 }
  let totalEventsFetched = 0
  let firstEventTime: number | undefined
  const now = Date.now()

  try {
    // A near-empty library is being filled for the first time, so hold the gate
    // until the catch-up finishes instead of dismissing early on a low new-file
    // count. Only checked while the gate is pending. Computed inside the try so
    // a fileCount() throw still reaches the finally that restores isSyncingDown.
    const hydrating =
      app.sync.getState().syncGateStatus === 'pending'
        ? (await app.library.fileCount()) < SYNC_GATE_HYDRATION_MIN
        : false

    while (true) {
      if (signal.aborted) break
      try {
        const cursor = await app.sync.getSyncDownCursor()
        logger.debug('syncDownEvents', 'syncing', {
          id: cursor?.id,
          after: cursor?.after,
        })

        const events = await sdk.objectEvents(cursor, batchSize)
        totalEventsFetched += events.length

        if (totalEventsFetched > 1) {
          app.sync.setState({
            isSyncingDown: true,
            syncDownCount: counts.total,
          })
        }

        // If the batch size is 1, we are probably synced and repeatedly polling the last event.
        if (events.length === 1) {
          logger.debug('syncDownEvents', 'batch', { size: events.length })
        } else {
          logger.info('syncDownEvents', 'batch', { size: events.length })
        }

        const prevTotal = counts.total
        await processBatch(events, counts, signal, app, internal)
        const batchChanged = counts.total > prevTotal

        // Move the gate now this batch is classified. Skip empty/aborted
        // batches: fileCreates is final only after the commit, and an aborted
        // run leaves the gate to `finally`, which preserves it across suspension.
        if (!signal.aborted && totalEventsFetched > 1) {
          const current = app.sync.getState().syncGateStatus
          const next = nextGateStatus(current, counts.fileCreates, hydrating)
          if (next !== current) app.sync.setState({ syncGateStatus: next })
        }

        // Track the first event's timestamp for progress estimation.
        if (firstEventTime === undefined && events.length > 0) {
          firstEventTime = events[0].updatedAt.getTime()
        }

        // The server's (updated_at, id) tuple-compare walks within a
        // same-ms cluster via the id tiebreak, so the lastEvent's exact
        // (updatedAt, id) is the correct cursor.
        const lastEvent = events[events.length - 1]
        if (lastEvent) {
          await app.sync.setSyncDownCursor({
            id: lastEvent.id,
            after: lastEvent.updatedAt,
          })
        }

        // Estimate progress as how far through the event timeline we are.
        const timeRange = firstEventTime !== undefined ? now - firstEventTime : 0
        const elapsed =
          lastEvent && firstEventTime !== undefined
            ? lastEvent.updatedAt.getTime() - firstEventTime
            : 0
        const progress = timeRange > 0 ? Math.min(elapsed / timeRange, 1) : 0

        // Update progress after each batch. Only report isSyncing when there are
        // real events to process (>1), not on the periodic heartbeat check which
        // returns a single cursor-marker event.
        app.sync.setState({
          isSyncingDown: totalEventsFetched > 1,
          syncDownCount: counts.total,
          syncDownProgress: progress,
        })
        if (batchChanged) {
          app.caches.library.invalidateAll()
          app.caches.libraryVersion.invalidate()
        }

        // If the batch is not full, we're done for now.
        if (events.length < batchSize) {
          break
        }

        // Unreachable on a correct server — a full batch's lastEvent is
        // always strictly past the cursor. If a server bug or deploy
        // mismatch ever lands here, break instead of spinning.
        if (
          cursor &&
          lastEvent &&
          lastEvent.id === cursor.id &&
          lastEvent.updatedAt.getTime() === cursor.after.getTime()
        ) {
          logger.warn('syncDownEvents', 'cursor_did_not_advance', {
            id: lastEvent.id,
            after: lastEvent.updatedAt,
            batchSize: events.length,
          })
          break
        }
      } catch (e) {
        logger.error('syncDownEvents', 'sync_error', { error: e as Error })
        break
      }
    }
  } finally {
    // Always restore isSyncingDown so a throw anywhere above can't leave it
    // stuck at `true` — otherwise thumbnailScanner and syncUpMetadata remain
    // gated until the next successful tick. Planner-stat refresh is delegated
    // to the 60s dbOptimize scheduler; running it here was 6× more frequent
    // than needed and fired on empty ticks.
    logger.info('syncDownEvents', 'synced', { total: counts.total })
    const willContinue = totalEventsFetched > 1 && !signal.aborted
    const endGateStatus = app.sync.getState().syncGateStatus
    // Preserve the gate on suspension abort: it must stay shown to the user
    // and continue blocking other services across sessions until sync
    // actually completes — never dismissed against an incomplete sync.
    const dismissGate =
      !signal.aborted &&
      (endGateStatus === 'pending' || (endGateStatus === 'active' && !willContinue))
    app.sync.setState({
      isSyncingDown: willContinue,
      syncDownCount: counts.total,
      ...(dismissGate && { syncGateStatus: 'dismissed' }),
    })
  }

  if (totalEventsFetched > 1 && !signal.aborted) {
    return 0 // zero interval: poll again immediately
  }
}

/**
 * Apply a batch of indexer events to the local state. Runs in three zones:
 *
 *   1. Classify (no writes) — decode + categorize each event as create / update / delete.
 *   2. Transaction (atomic SQL writes) — file upserts, localObject upserts, deletes
 *      (tombstone + drop localObjects), directory + tag sync, `current` recalc,
 *      empty-directory cleanup.
 *   3. Post-commit (non-atomic) — filesystem cleanup of orphan local files, then cache
 *      invalidation. Outside the transaction because FS ops aren't transactional and
 *      cache subscribers must observe committed state.
 *
 * On transaction error the rollback prevents cursor advancement so the same batch is
 * retried next cycle. Aborts via `signal` are checked at every exit point so suspension
 * releases the transaction promptly.
 */
async function processBatch(
  events: {
    id: string
    object?: PinnedObjectRef
    deleted?: boolean
    updatedAt: Date
  }[],
  counts: Counts,
  signal: AbortSignal,
  app: AppService,
  internal: AppServiceInternal,
) {
  const indexerURL = await app.settings.getIndexerURL()
  const appKey = internal.requireSdk().appKey()

  // Classify events: decode metadata using batch reads. Events with malformed
  // or incomplete metadata are skipped (the only legitimate skip).
  const deleteObjectIds: string[] = []
  const upsertEntries: {
    objectId: string
    object: PinnedObjectRef
    metadata: FileMetadata
    type: 'file' | 'thumbnail'
  }[] = []

  for (const { object, deleted, id } of events) {
    if (signal.aborted) return
    if (deleted) {
      deleteObjectIds.push(id)
      continue
    }
    if (!object) continue
    try {
      const metadata = decodeFileMetadata(object.metadata())
      if (hasCompleteThumbnailMetadata(metadata)) {
        upsertEntries.push({
          objectId: id,
          object,
          metadata,
          type: 'thumbnail',
        })
      } else if (hasCompleteFileMetadata(metadata)) {
        upsertEntries.push({ objectId: id, object, metadata, type: 'file' })
      } else {
        logger.debug('syncDownEvents', 'skipped', {
          reason: 'incomplete_metadata',
        })
      }
    } catch (e) {
      logger.error('syncDownEvents', 'decode_error', {
        id,
        error: e as Error,
      })
      throw e
    }
  }

  // Batch reads: 2 queries instead of N individual lookups.
  const metadataIds = [...new Set(upsertEntries.map((e) => e.metadata.id))]
  const [deleteFileMap, upsertFileMap] = await Promise.all([
    deleteObjectIds.length > 0
      ? app.files.getRowsByObjectIds(deleteObjectIds, indexerURL)
      : new Map<string, FileRecordRow>(),
    metadataIds.length > 0 ? app.files.getRowsByIds(metadataIds) : new Map<string, FileRecordRow>(),
  ])

  // Classify events using batch results.
  const prepared: PreparedEvent[] = []

  for (const objectId of deleteObjectIds) {
    const existing = deleteFileMap.get(objectId)
    if (!existing) {
      logger.debug('syncDownEvents', 'skipped', {
        reason: 'no_file_record',
        objectId,
      })
      continue
    }
    logger.debug('syncDownEvents', 'file_delete', { fileId: existing.id })
    prepared.push({
      kind: 'delete',
      objectId,
      fileId: existing.id,
      fileRecord: existing,
      indexerURL,
    })
  }

  for (const { object, metadata, type } of upsertEntries) {
    const existing = upsertFileMap.get(metadata.id)
    if (existing) {
      if (type === 'file') {
        logger.debug('syncDownEvents', 'file_update', { hash: existing.hash })
      } else {
        logger.debug('syncDownEvents', 'thumbnail_update', {
          thumbForId: existing.thumbForId,
        })
      }
      const localObject = sealPinnedObject(existing.id, indexerURL, object, appKey)
      // Heal a wrong stored size from the SDK's size (local-only, no sync-up).
      const realSize = Number(object.size())
      // Ties favor remote here (>=); sync-up's isLocalNewer favors local (also
      // >=). The opposite directions are intentional: on an equal-updatedAt
      // collision sync-down takes remote and sync-up pushes local, so one edit
      // can't both win and lose. A genuine local edit bumps updatedAt to now, so
      // it is strictly newer and never hits this tie.
      const isRemoteNewer = metadata.updatedAt >= existing.updatedAt
      const mergedMetadata = isRemoteNewer ? toFileRecordFields(metadata) : {}
      prepared.push({
        kind: 'update',
        fileRecord: {
          ...existing,
          ...mergedMetadata,
          ...(realSize > 0 ? { size: realSize } : {}),
        },
        localObject,
        fileId: existing.id,
        tags: metadata.tags,
        directory: metadata.directory,
        isFile: type === 'file',
        isRemoteNewer,
      })
    } else {
      const fileId = metadata.id
      if (type === 'file') {
        logger.debug('syncDownEvents', 'file_create', { hash: metadata.hash })
      } else {
        logger.debug('syncDownEvents', 'thumbnail_create', {
          thumbForId: metadata.thumbForId,
        })
      }
      const localObject = sealPinnedObject(fileId, indexerURL, object, appKey)
      const realSize = Number(object.size())
      prepared.push({
        kind: 'create',
        fileRecord: {
          ...toFileRecordFields(metadata),
          ...(realSize > 0 ? { size: realSize } : {}),
          id: fileId,
          mediaAssetId: null,
          addedAt: Date.now(),
          deletedAt: null,
        },
        localObject,
        tags: metadata.tags,
        directory: metadata.directory,
        isFile: type === 'file',
      })
    }
  }

  if (prepared.length === 0 || signal.aborted) return

  // Dedup: multiple objects can share metadata.id (e.g., same file uploaded
  // from two devices pre-migration). Classification happens before any writes,
  // so both resolve as 'create'. Convert duplicates to 'update' so the file
  // record is created only once while each object's localObject is upserted.
  const seenFileIds = new Set<string>()
  for (const event of prepared) {
    if (event.kind !== 'create') continue
    const id = event.fileRecord.id
    if (seenFileIds.has(id)) {
      const e = event as unknown as PreparedUpdate
      e.kind = 'update'
      e.fileId = id
      e.isRemoteNewer = true
    } else {
      seenFileIds.add(id)
    }
  }

  const creates = prepared.filter((e): e is PreparedCreate => e.kind === 'create')
  const updates = prepared.filter((e): e is PreparedUpdate => e.kind === 'update')
  const deletes = prepared.filter((e): e is PreparedDelete => e.kind === 'delete')

  let deletedFileIds: string[] = []
  let toTombstone: string[] = []
  let oldDirGroups: { name: string; directoryId: string | null }[] = []
  let emptyDirsDeleted = 0

  const syncableEvents = prepared.filter(
    (e): e is PreparedCreate | PreparedUpdate =>
      e.kind !== 'delete' &&
      e.isFile &&
      (e.kind === 'create' || (e.kind === 'update' && e.isRemoteNewer)),
  )
  const dirEntries = syncableEvents
    .filter((e) => e.directory !== undefined)
    .map((e) => ({ fileId: e.fileRecord.id, directoryPath: e.directory! }))
  const tagEntries = syncableEvents
    .filter((e) => e.tags !== undefined && e.tags.length > 0)
    .map((e) => ({ fileId: e.fileRecord.id, tagNames: e.tags! }))

  await internal.withTransaction(async () => {
    // Apply remote metadata only for creates and remote-newer, non-tombstoned
    // updates. ON CONFLICT(id) preserves addedAt/mediaAssetId/deletedAt/lostReason,
    // and a locally-tombstoned row is skipped so a delete-in-progress isn't
    // reverted by a stale remote edit (delete wins).
    const remoteWins = updates.filter((e) => e.isRemoteNewer && !e.fileRecord.deletedAt)
    const fileUpserts = [
      ...creates.map((e) => e.fileRecord),
      ...remoteWins.map((e) => e.fileRecord),
    ]
    if (fileUpserts.length > 0) {
      await app.files.upsertMany(fileUpserts, { skipCurrentRecalc: true })
    }

    // Refresh every object's sealed metadata (creates + all updates), but leave
    // the dirty flag untouched: a locally-newer object keeps its pending push,
    // and a create's new row defaults to clean.
    const allLocalObjects = [
      ...creates.map((e) => e.localObject),
      ...updates.map((e) => e.localObject),
    ]
    if (allLocalObjects.length > 0) {
      await app.localObjects.upsertMany(allLocalObjects, { skipInvalidation: true })
    }

    // Remote won the metadata, so clear the flag on those objects (locally-newer
    // and tombstoned objects are excluded above).
    const remoteWonObjectIds = remoteWins.map((e) => e.localObject.id)
    if (remoteWonObjectIds.length > 0) {
      await app.localObjects.clearMany(indexerURL, remoteWonObjectIds)
    }

    // Apply deletes: drop localObjects, tombstone files that aren't already
    // tombstoned, then identify files with no remaining objects (fully deleted).
    if (deletes.length > 0) {
      await app.localObjects.deleteManyByObjectIds(
        deletes.map((e) => e.objectId),
        indexerURL,
        { skipInvalidation: true },
      )

      toTombstone = deletes.filter((e) => !e.fileRecord.deletedAt).map((e) => e.fileId)
      if (toTombstone.length > 0) {
        // Remote-originated delete: don't flag the objects (setNeedsSyncUp:false).
        // They were just dropped locally and removed remotely, so there is
        // nothing to push.
        await app.files.tombstone(toTombstone, { skipInvalidation: true, setNeedsSyncUp: false })
      }

      const deleteFileIdSet = [...new Set(deletes.map((e) => e.fileId))]
      deletedFileIds = await app.localObjects.queryFilesWithNoObjects(deleteFileIdSet)
    }

    // Sync directory associations from metadata.
    if (dirEntries.length > 0) {
      oldDirGroups = await app.directories.syncManyFromMetadata(dirEntries, {
        skipInvalidation: true,
      })
    }

    // Sync tag associations from metadata.
    if (tagEntries.length > 0) {
      await app.tags.syncManyFromMetadata(tagEntries, {
        skipInvalidation: true,
      })
    }

    // Recalculate `current` for all affected version groups in one pass,
    // rather than per-file during the batch.
    const affectedFileIds: string[] = []
    for (const e of prepared) {
      if (e.kind === 'delete') {
        affectedFileIds.push(e.fileId)
      } else if (e.isFile) {
        affectedFileIds.push(e.fileRecord.id)
      }
    }
    if (affectedFileIds.length > 0) {
      await app.files.recalculateCurrent(affectedFileIds)
    }
    // Recalculate old directory groups. When a file moves from dir-A to dir-B,
    // the file-ID-based recalc above handles dir-B (the file's current dir).
    // dir-A needs separate recalc to promote the next version as current.
    if (oldDirGroups.length > 0) {
      await app.files.recalculateCurrentForGroups(oldDirGroups)
    }

    // Clean up directories left empty by this batch. Must run after the
    // `current` recalc above — buildRecordFilter checks `current = 1`.
    // Candidates come from two sources: directories of files that were
    // tombstoned or fully deleted, and source directories of moves
    // (captured in oldDirGroups when files relocated via sync).
    const candidateDirIds = new Set<string>()
    for (const g of oldDirGroups) {
      if (g.directoryId !== null) candidateDirIds.add(g.directoryId)
    }
    const newlyInactiveFiles = [...new Set([...toTombstone, ...deletedFileIds])]
    if (newlyInactiveFiles.length > 0) {
      for (const id of await app.files.getDirectoryIdsForFiles(newlyInactiveFiles)) {
        candidateDirIds.add(id)
      }
    }
    if (candidateDirIds.size > 0) {
      emptyDirsDeleted = await app.directories.deleteEmpty([...candidateDirIds], {
        skipInvalidation: true,
      })
    }
  })

  // counts.total is updated after the transaction commits. On mobile,
  // withTransaction can rerun the closure after reopening the DB handle,
  // and an in-closure `+=` would double-count on retry.
  counts.total += creates.length + updates.length + deletedFileIds.length
  counts.fileCreates += creates.filter((e) => e.isFile).length

  // Filesystem cleanup runs after the transaction commits. FS isn't
  // transactional, and an orphan-on-disk after a committed delete is
  // recoverable; lost-data-without-FS-deletion is not, so SQL-first
  // ordering is intentional. Non-fatal errors are logged. Check signal
  // between deletions so suspension can close the DB promptly.
  const deletedFileIdSet = new Set(deletedFileIds)
  for (const event of deletes) {
    if (signal.aborted) break
    if (deletedFileIdSet.has(event.fileId)) {
      try {
        await app.fs.removeFile({
          id: event.fileRecord.id,
          type: event.fileRecord.type,
        })
      } catch (e) {
        logger.error('syncDownEvents', 'cleanup_error', {
          error: e as Error,
        })
      }
    }
  }

  // Cache invalidations fire after the transaction commits so subscribers
  // never see stale state mid-write.
  let needsLibraryInvalidation =
    creates.length > 0 || dirEntries.length > 0 || tagEntries.length > 0 || emptyDirsDeleted > 0
  for (const event of updates) {
    app.caches.fileById.invalidate(event.fileId)
    needsLibraryInvalidation = true
  }
  if (needsLibraryInvalidation) {
    app.caches.tags.invalidateAll()
    app.caches.directories.invalidateAll()
    app.caches.libraryVersion.invalidate()
  }
}

/** Map decoded metadata to file record fields (all v1 fields preserved). */
function toFileRecordFields(
  metadata: FileMetadata,
): Omit<FileRecordRow, 'id' | 'mediaAssetId' | 'addedAt' | 'deletedAt'> {
  return {
    name: metadata.name,
    type: metadata.type,
    kind: metadata.kind,
    size: metadata.size,
    hash: metadata.hash,
    createdAt: metadata.createdAt,
    updatedAt: metadata.updatedAt,
    thumbForId: metadata.thumbForId,
    thumbSize: metadata.thumbSize,
    trashedAt: metadata.trashedAt ?? null,
  }
}
