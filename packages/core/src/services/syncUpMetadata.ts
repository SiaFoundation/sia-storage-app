import { logger } from '@siastorage/logger'
import type { PinnedObjectRef } from '../adapters/sdk'
import {
  MAX_SUPPORTED_VERSION,
  decodeFileMetadata,
  encodeFileMetadata,
} from '../encoding/fileMetadata'
import { SlotPool } from '../lib/slotPool'
import type { FileMetadata, FileRecord } from '../types/files'
import { fileMetadataKeys } from '../types/files'
import type { FileRecordsQueryOpts } from '../db/operations/files'

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
  }
  files: {
    readAll(opts: FileRecordsQueryOpts): Promise<FileRecord[]>
    readAllCount(opts: FileRecordsQueryOpts): Promise<number>
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
      if (f.kind === 'thumb' && !f.thumbForId) return
      return pool.withSlot(async () => {
        if (signal.aborted) return
        const ctx = { fileId: f.id, objectId: obj.id, fileName: f.name }

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
          let fileToEncode: FileMetadata =
            remoteMeta.id && remoteMeta.id !== f.id
              ? { ...f, id: remoteMeta.id }
              : f
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
            thumbForHash: remoteMeta.thumbForHash,
            thumbSize: fileToEncode.thumbSize,
          })
          const result = await tryWithLog(
            () => {
              remote.updateMetadata(
                encodeFileMetadata(fileToEncode, {
                  thumbForHash: remoteMeta.thumbForHash,
                }),
              )
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
