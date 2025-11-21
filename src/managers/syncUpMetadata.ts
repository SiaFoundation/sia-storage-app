import { logger } from '../lib/logger'
import {
  fileMetadataKeys,
  readAllFileRecords,
  type FileMetadata,
} from '../stores/files'
import { getIndexerURL } from '../stores/settings'
import { getIsConnected, getPinnedObject, updateMetadata } from '../stores/sdk'
import { createServiceInterval } from '../lib/serviceInterval'
import { getAsyncStorageJSON, setAsyncStorageJSON } from '../stores/asyncStore'
import { z } from 'zod'
import {
  SYNC_UP_METADATA_INTERVAL,
  SYNC_UP_METADATA_BATCH_SIZE,
} from '../config'
import {
  encodeFileMetadata,
  decodeFileMetadata,
} from '../encoding/fileMetadata'

type DiffEntry = { local: unknown; remote: unknown }
type DiffResult = Record<keyof FileMetadata, DiffEntry>

export function diffFileMetadata(
  localMeta: FileMetadata,
  remoteMeta: FileMetadata
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

/**
 * Format field-level metadata diffs as git-style +/- lines.
 * '+' denotes the newer value, '-' denotes the older value. Side labels: 'l' = local, 'r' = remote.
 *
 * Example (newerSide = 'local'):
 * -r name: "old.jpg"
 * +l name: "new.jpg"
 * -r updatedAt: 1700000000000
 * +l updatedAt: 1700005000000
 */
export function formatMetadataDiff(
  diffs: Partial<DiffResult>,
  isLocalNewer: boolean
): string {
  const lines: string[] = []
  const keys = Object.keys(diffs) as (keyof FileMetadata)[]
  for (const key of keys) {
    const entry = diffs[key]
    if (!entry) continue
    const oldVal = isLocalNewer ? entry.remote : entry.local
    const newVal = isLocalNewer ? entry.local : entry.remote
    const oldStr = JSON.stringify(oldVal)
    const newStr = JSON.stringify(newVal)
    const oldSide = isLocalNewer ? 'r' : 'l'
    const newSide = isLocalNewer ? 'l' : 'r'
    lines.push(`-${oldSide} ${String(key)}: ${oldStr}`)
    lines.push(`+${newSide} ${String(key)}: ${newStr}`)
  }
  return lines.join('\n')
}

function formatTimestamp(ts?: number): string {
  if (!ts || ts <= 0) return 'n/a'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(ts))
}

function formatDiff(params: {
  fileId: string
  objectId: string
  localMeta: FileMetadata
  remoteMeta: FileMetadata
  diffs: Partial<DiffResult>
  isLocalNewer: boolean
}): string {
  const { fileId, objectId, localMeta, remoteMeta, diffs, isLocalNewer } =
    params
  const headerLeft = `local (l) updated at ${formatTimestamp(
    localMeta.updatedAt
  )}`
  const headerRight = `remote (r) updated at ${formatTimestamp(
    remoteMeta.updatedAt
  )}`
  const status = isLocalNewer ? 'local newer' : 'remote newer'
  const diff = formatMetadataDiff(diffs, isLocalNewer)
  return `[syncUpMetadata] fileId=${fileId} objectId=${objectId}\n${headerLeft}    ${headerRight}\n${status} • ${diff}`
}

export type MetadataSyncResult = {
  scanned: number
  withDiffs: number
  updatedRemote: number
  skipped: number
  failed: number
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
  }
)

type SyncUpCursor = {
  updatedAt: number
  id: string
}

export async function getSyncUpCursor(): Promise<SyncUpCursor | undefined> {
  return getAsyncStorageJSON('syncUpCursor', syncUpCursorCodec)
}

export async function setSyncUpCursor(
  value: SyncUpCursor | undefined
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
    logger.log('[syncUpMetadata] not connected to indexer, skipping')
    return
  }
  const indexerURL = await getIndexerURL()
  const after = await getSyncUpCursor()
  logger.log(
    `[syncUpMetadata] service tick: from ${after?.id ?? 'begin'} after=${
      after?.updatedAt
    }`
  )
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
    logger.log('[syncUpMetadata] no new updates')
    return
  }
  for (const f of batch) {
    const obj = f.objects[indexerURL]
    if (!obj || !obj.id) continue
    try {
      const remote = await getPinnedObject(obj.id)
      const remoteMeta = decodeFileMetadata(remote.metadata())
      const diffs = diffFileMetadata(f, remoteMeta)
      if (Object.keys(diffs).length === 0) continue
      const isLocalNewer = (f.updatedAt || 0) >= (remoteMeta.updatedAt || 0)
      logger.log(
        formatDiff({
          fileId: f.id,
          objectId: obj.id,
          localMeta: f,
          remoteMeta,
          diffs,
          isLocalNewer,
        })
      )
      if (isLocalNewer) {
        await updateMetadata(remote, encodeFileMetadata(f))
      }
    } catch (e) {
      logger.log('[syncUpMetadata] error', e)
    }
  }
  const last = batch[batch.length - 1]
  if (batch.length < batchSize) {
    await setSyncUpCursor({
      updatedAt: last.updatedAt + 1,
      id: last.id,
    })
    logger.log('[syncUpMetadata] end reached')
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
