import { logger } from '@siastorage/logger'
import type { AppService, AppServiceInternal } from '../app/service'
import {
  decodeFileMetadata,
  encodeFileMetadata,
  MAX_SUPPORTED_VERSION,
  readMetadataVersion,
} from '../encoding/fileMetadata'
import { isObjectNotFoundError } from '../lib/errors'
import { SlotPool } from '../lib/slotPool'
import { type FileMetadata, fileMetadataKeys } from '../types/files'

type DiffEntry = { local: unknown; remote: unknown }

function tagsEqual(a: string[] | undefined, b: string[] | undefined): boolean {
  const listA = a ?? []
  const listB = b ?? []
  if (listA.length !== listB.length) return false
  const sortedA = [...listA].sort()
  const sortedB = [...listB].sort()
  return sortedA.every((tag, i) => tag === sortedB[i])
}

export function diffFileMetadata(
  localMeta: FileMetadata,
  remoteMeta: FileMetadata,
): Record<string, DiffEntry> {
  const diffs: Record<string, DiffEntry> = {}
  for (const key of fileMetadataKeys) {
    // trashedAt is only encoded for kind==='file' (see encodeFileMetadata), so a
    // thumb's remote always decodes to trashedAt:null — skip it to avoid a
    // phantom diff (and a wasted push) every time a thumbnail is trashed.
    if (key === 'trashedAt' && localMeta.kind === 'thumb') continue
    const localValue = localMeta[key] ?? null
    const remoteValue = remoteMeta[key] ?? null
    if (localValue !== remoteValue) {
      diffs[key] = { local: localValue, remote: remoteValue }
    }
  }
  // tags and directory ARE part of the pushed payload (encodeFileMetadata)
  // but are NOT in fileMetadataKeys — they live in separate tables. Compare
  // them explicitly so a tag/directory-only edit is detected even when
  // updatedAt coincidentally equals remote. Tags are order-insensitive.
  if (!tagsEqual(localMeta.tags, remoteMeta.tags)) {
    diffs.tags = { local: localMeta.tags ?? null, remote: remoteMeta.tags ?? null }
  }
  const localDir = localMeta.directory ?? null
  const remoteDir = remoteMeta.directory ?? null
  if (localDir !== remoteDir) {
    diffs.directory = { local: localDir, remote: remoteDir }
  }
  return diffs
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
 * Walk the objects pinned to the current indexer with `needsSyncUp = 1`. For a
 * tombstoned file, delete the remote object and drop the local object row; else
 * fetch remote metadata, diff against the live local metadata, and push if local
 * is newer. After a push (or no-diff / remote-newer), CAS-clear the object's
 * flag against the live `files.updatedAt`, so an edit landing mid-round-trip
 * fails the CAS and is retried on the next pass.
 *
 * TODO: Multi-indexer cleanup gap. Currently we only connect to one
 * indexer at a time, so this function only deletes objects for the
 * current indexer. If a file has objects on Indexer A and B, and gets
 * tombstoned while connected to A, only A's object is deleted. B's
 * object row persists locally (flagged, pending) until that indexer is
 * next connected.
 *
 * Suspension signal policy: accepts AbortSignal. DB-holding loop —
 * reads remote metadata and writes local DB. Checks signal at exit
 * points so a mid-batch abort doesn't issue queries after the gate.
 * Waits for the DB gate before the first remote call so a tombstone
 * delete that already succeeded on the indexer doesn't lose its
 * local cleanup write.
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
  await app.db.waitUntilActive()
  if (signal.aborted) return

  const sdk = internal.requireSdk()
  const indexerURL = await app.settings.getIndexerURL()
  // Dirty objects pinned to this indexer — one row per push target.
  const batch = await app.localObjects.getSyncUpBatch(indexerURL, batchSize)
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
    const total = await app.localObjects.countSyncUp(indexerURL)
    app.sync.setState({
      isSyncingUp: true,
      syncUpProcessed: 0,
      syncUpTotal: total,
    })
  }
  const pool = new SlotPool(concurrency)
  await Promise.all(
    batch.map((row) =>
      pool.withSlot(async () => {
        if (signal.aborted) return
        const ctx = { fileId: row.fileId, objectId: row.objectId, fileName: row.fileName }

        // Tombstoned file: delete the remote object, then drop the local row (the
        // flag dies with it). The file row stays — the tombstone is the permanent
        // cross-device delete record. A transient deleteObject failure leaves the
        // object flagged to retry; "object not found" means it's already gone.
        if (row.deletedAt) {
          let deleted = false
          try {
            await sdk.deleteObject(row.objectId)
            deleted = true
          } catch (e) {
            if (isObjectNotFoundError(e)) {
              deleted = true
              logger.info('syncUpMetadata', 'deleteObject_already_gone', ctx)
            } else {
              logger.error('syncUpMetadata', 'deleteObject_failed', { ...ctx, error: e as Error })
            }
          }
          if (!deleted) return
          await app.localObjects.delete(row.objectId, indexerURL)
          return
        }

        const remote = await tryWithLog(
          () => sdk.getPinnedObject(row.objectId),
          'getPinnedObject',
          ctx,
        )
        if (!remote) return

        const remoteMeta = await tryWithLog(
          () => decodeFileMetadata(remote.metadata()),
          'decodeFileMetadata',
          ctx,
        )
        if (!remoteMeta) return

        const remoteVersion = readMetadataVersion(remote.metadata())
        if (remoteVersion > MAX_SUPPORTED_VERSION) {
          logger.warn('syncUpMetadata', 'skipping_newer_version', {
            ...ctx,
            remoteVersion,
            maxSupported: MAX_SUPPORTED_VERSION,
          })
          // Nothing safe to push. Clear against the batch-time clock — this branch
          // exits before the live read; a future local edit re-flags it.
          await app.localObjects.clearIfUnchanged(row.objectId, indexerURL, row.fileUpdatedAt)
          return
        }

        // Read the full current local metadata (tags and directory live in
        // separate tables yet are part of the pushed payload). Diffing and the
        // CAS clear key on this live read, taken AFTER the round-trip: an edit
        // landing mid-round-trip is folded into the push and clears cleanly,
        // while a later edit fails the CAS and is retried.
        const live = await app.files.getMetadataForSync(row.fileId)
        if (!live) return
        // Tombstoned mid-round-trip: leave it flagged so the next pass routes
        // through the delete branch instead of pushing an object that must go.
        if (live.deletedAt) return
        const local = live.metadata

        const diffs = diffFileMetadata(local, remoteMeta)
        if (Object.keys(diffs).length === 0) {
          await app.localObjects.clearIfUnchanged(row.objectId, indexerURL, local.updatedAt)
          return
        }

        const isLocalNewer = (local.updatedAt || 0) >= (remoteMeta.updatedAt || 0)
        logger.info('syncUpMetadata', 'metadata_diff', {
          fileId: row.fileId,
          objectId: row.objectId,
          localUpdatedAt: local.updatedAt,
          remoteUpdatedAt: remoteMeta.updatedAt,
          newerSide: isLocalNewer ? 'local' : 'remote',
          diffs,
        })

        if (!isLocalNewer) {
          // Remote is newer; sync-down reconciles. Stop walking until it changes.
          await app.localObjects.clearIfUnchanged(row.objectId, indexerURL, local.updatedAt)
          return
        }

        logger.info('syncUpMetadata', 'pushing_v1', {
          fileId: local.id,
          objectId: row.objectId,
          kind: local.kind,
          thumbForId: local.thumbForId,
          thumbSize: local.thumbSize,
        })
        const result = await tryWithLog(
          () => {
            remote.updateMetadata(encodeFileMetadata(local))
            return sdk.updateObjectMetadata(remote)
          },
          'updateMetadata',
          ctx,
        )
        if (result === null) return
        await app.localObjects.clearIfUnchanged(row.objectId, indexerURL, local.updatedAt)
      }),
    ),
  )
  // Progress for the UI: objects attempted this pass, not unique rows cleared. A
  // failed object stays flagged and is re-counted next pass, so this can exceed
  // syncUpTotal under sustained retries.
  const prevProcessed = app.sync.getState().syncUpProcessed ?? 0
  app.sync.setState({
    isSyncingUp: true,
    syncUpProcessed: prevProcessed + batch.length,
  })
  // One object = one work item, so a short batch may mean we are done — but a
  // failed object stays flagged, so confirm with a live count before finishing.
  if (batch.length < batchSize) {
    const remaining = await app.localObjects.countSyncUp(indexerURL)
    if (remaining === 0) {
      app.sync.setState({
        isSyncingUp: false,
        syncUpProcessed: 0,
        syncUpTotal: 0,
      })
      logger.debug('syncUpMetadata', 'end_reached')
    }
  }
}
