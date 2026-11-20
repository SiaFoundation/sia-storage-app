import type { DatabaseAdapter } from '@siastorage/core/adapters'
import type { AppService } from '@siastorage/core/app'
import { OLDER_VERSION_TRASH_AGE } from '@siastorage/core/config'
import * as ops from '@siastorage/core/db/operations'
import { INDEXER_URL, LIBRARY_SAMPLES } from './dataset'
import type { QuerySpec } from './types'

export function buildQuerySpecs(
  app: AppService,
  sampleDirId: string,
  sampleTagId: string,
  sampleFileId: string,
): QuerySpec[] {
  return [
    {
      name: 'libraryFileCount',
      category: 'count',
      run: () => app.library.fileCount(),
    },
    {
      name: 'mediaFileCount',
      category: 'count',
      run: () => app.library.mediaCount(),
    },
    {
      name: 'tagFileCount',
      category: 'count',
      run: () => app.library.tagFileCount(sampleTagId),
    },
    {
      name: 'directoryFileCount',
      category: 'count',
      run: () => app.library.directoryFileCount(sampleDirId),
    },
    {
      name: 'unfiledFileCount',
      category: 'count',
      run: () => app.library.unfiledFileCount(),
    },
    {
      name: 'countWithFilters:imageOnly',
      category: 'count',
      run: () =>
        app.library.countWithFilters({
          categories: ['Image'],
          tags: [],
        }),
    },
    {
      name: 'countWithFilters:withTag',
      category: 'count',
      run: () =>
        app.library.countWithFilters({
          tags: [sampleTagId],
        }),
    },
    {
      name: 'countWithFilters:withDirectory',
      category: 'count',
      run: () =>
        app.library.countWithFilters({
          directoryId: sampleDirId,
          tags: [],
        }),
    },

    {
      name: 'sortedFileIds:date:page1',
      category: 'pagination',
      run: () => app.library.sortedFileIds({ tags: [] }, 50, 0),
    },
    {
      name: 'sortedFileIds:date:deepPage',
      category: 'pagination',
      run: () => app.library.sortedFileIds({ tags: [] }, 50, 50_000),
    },
    {
      name: 'sortedFileIds:name:page1',
      category: 'pagination',
      run: () => app.library.sortedFileIds({ sortBy: 'NAME', tags: [] }, 50, 0),
    },
    {
      name: 'sortedFileIds:size:page1',
      category: 'pagination',
      run: () => app.library.sortedFileIds({ sortBy: 'SIZE', tags: [] }, 50, 0),
    },
    {
      name: 'filePosition',
      category: 'pagination',
      run: () =>
        app.library.filePosition(sampleFileId, {
          sortBy: 'DATE',
          sortDir: 'DESC',
          tags: [],
        }),
    },

    {
      name: 'uploadStats',
      category: 'stats',
      run: () => app.stats.uploadStats(INDEXER_URL),
    },

    {
      name: 'allDirectoriesWithCounts',
      category: 'directories',
      run: () => app.directories.getAll(),
    },
    {
      name: 'directoryChildren:root',
      category: 'directories',
      run: () => app.directories.getChildren(null),
    },

    {
      name: 'thumbnailCandidatePage',
      category: 'thumbnails',
      run: () => app.thumbnails.queryCandidatePage(50, undefined, app.thumbnails.allowedTypes),
    },
    {
      name: 'thumbnailScanProgress',
      category: 'thumbnails',
      run: () => app.thumbnails.queryProgress(app.thumbnails.allowedTypes),
    },

    // One batch of the orphan scan, which checks every name in the files
    // folder in batches of this size.
    {
      name: 'orphanScanBatch:orphanedIds',
      category: 'orphanScan',
      run: async () => [
        ...(await app.fs.findOrphanedFileIds(ORPHAN_SCAN_BATCH, { writtenSince: 0 })),
      ],
    },
    {
      name: 'orphanScanBatch:liveTypes',
      category: 'orphanScan',
      run: async () => [...(await app.fs.liveFileTypes(ORPHAN_SCAN_BATCH))],
    },
  ]
}

const ORPHAN_SCAN_BATCH = Array.from({ length: 500 }, (_, i) => `f-${i * 7}`)

/**
 * Write benchmarks for version group operations. Those that only need undoing
 * run inside a transaction that is rolled back after each run. Trash and move
 * run as the app runs them and undo their own mutations.
 */
export function buildWriteQuerySpecs(db: DatabaseAdapter, sampleDirId: string): QuerySpec[] {
  // The ops open their own transaction, and SQLite cannot BEGIN inside a
  // SAVEPOINT, so the rollback has to come from the adapter's transaction. The
  // op joins it through `tx`, and throwing at the end rolls the whole run back.
  const ROLLBACK = Symbol('rollback')
  function withRollback(fn: (tx: DatabaseAdapter) => Promise<unknown>): () => Promise<unknown> {
    return async () => {
      let result: unknown
      try {
        await db.withTransactionAsync(async (tx) => {
          result = await fn(tx)
          throw ROLLBACK
        })
      } catch (e) {
        if (e !== ROLLBACK) throw e
      }
      return result
    }
  }

  // Up to 10k file ids from the sample directory. Version groups spread over
  // 55 slots and the first 50 are directories, so each holds about 18k rows
  // (999k records / 55) at scale 1, and the "10k" specs touch fewer below
  // about scale 0.55.
  let largeDir10kIds: string[] | null = null
  async function getLargeDir10kIds(handle: DatabaseAdapter = db): Promise<string[]> {
    if (largeDir10kIds) return largeDir10kIds
    const rows = await handle.getAllAsync<{ id: string }>(
      `SELECT id FROM files WHERE directoryId = ? AND kind = 'file' LIMIT 10000`,
      sampleDirId,
    )
    largeDir10kIds = rows.map((r) => r.id)
    return largeDir10kIds
  }

  // The trash pass trashes an older version once a newer one is older than
  // `now - OLDER_VERSION_TRASH_AGE`. The dataset's stamps are relative to when
  // it was generated, so `now` is the stamp of the row that share of the way
  // through the files by updatedAt, which keeps results exact. Single-version
  // files come first in the dataset, so a cutoff up to about two thirds of
  // the way in has no older version due.
  async function trashPassNow(tx: DatabaseAdapter, share: number): Promise<number> {
    const row = await tx.getFirstAsync<{ updatedAt: number }>(
      `SELECT updatedAt FROM files WHERE kind = 'file' ORDER BY updatedAt
       LIMIT 1 OFFSET (SELECT CAST(count(*) * ? AS INTEGER) FROM files WHERE kind = 'file')`,
      share,
    )
    if (!row) throw new Error('dataset has no files')
    return row.updatedAt + OLDER_VERSION_TRASH_AGE
  }

  return [
    // Reads every older version older than the cutoff and trashes none, the
    // hourly pass's usual run.
    {
      name: 'trashOlderVersions:nothingDue',
      category: 'write',
      run: withRollback(async (tx) =>
        ops.trashOlderVersions(tx, INDEXER_URL, await trashPassNow(tx, 0.66)),
      ),
    },
    // About 1,400 versions due at scale 0.25, so the pass trashes three batches.
    {
      name: 'trashOlderVersions:due',
      category: 'write',
      run: withRollback(async (tx) =>
        ops.trashOlderVersions(tx, INDEXER_URL, await trashPassNow(tx, 0.689)),
      ),
    },
    {
      name: 'recalculateCurrentForGroup:single',
      category: 'write',
      run: withRollback((tx) =>
        ops.recalculateCurrentForGroup(tx, 'vgroup-100v-0.pdf', sampleDirId),
      ),
    },
    {
      name: 'recalculateCurrentForFileIds:500',
      category: 'write',
      run: withRollback(async (tx) => {
        const ids = Array.from({ length: 500 }, (_, i) => `f-${i * 100}`)
        await ops.recalculateCurrentForFileIds(tx, ids)
      }),
    },
    {
      name: 'recalculateCurrentForFileIds:10k',
      category: 'write',
      run: withRollback(async (tx) => {
        const ids = Array.from({ length: 10_000 }, (_, i) => `f-${i * 10}`)
        await ops.recalculateCurrentForFileIds(tx, ids)
      }),
    },
    {
      name: 'trashFilesAndThumbnails:1k',
      category: 'write',
      run: async () => {
        const ids = Array.from({ length: 1000 }, (_, i) => `f-${i}`)
        await ops.trashFilesAndThumbnails(db, ids)
        await ops.restoreFilesAndThumbnails(db, ids)
      },
    },
    {
      name: 'moveFilesAllVersions:1k',
      category: 'write',
      run: async () => {
        const ids = Array.from({ length: 1000 }, (_, i) => `f-${i}`)
        await ops.moveFilesAllVersions(db, ids, LIBRARY_SAMPLES.moveTargetDirId)
        await ops.moveFilesAllVersions(db, ids, sampleDirId)
      },
    },
    {
      name: 'upsertManyFiles:500',
      category: 'write',
      run: withRollback(async (tx) => {
        const now = Date.now()
        const records = Array.from({ length: 500 }, (_, i) => ({
          id: `upsert-${i}`,
          name: `upsert-bench-${i}.jpg`,
          type: 'image/jpeg',
          kind: 'file' as const,
          size: 1000 + i,
          hash: `sha256:upsert-hash-${i}` as const,
          createdAt: now,
          updatedAt: now,
          mediaAssetId: null,
          addedAt: now,
          thumbForId: undefined,
          thumbSize: undefined,
          trashedAt: null,
          deletedAt: null,
        }))
        await ops.upsertManyFiles(tx, records, {
          skipCurrentRecalc: true,
        })
      }),
    },
    {
      name: 'moveFilesAllVersions:10k',
      category: 'write',
      run: async () => {
        const ids = await getLargeDir10kIds()
        await ops.moveFilesAllVersions(db, ids, LIBRARY_SAMPLES.moveTargetDirId)
        await ops.moveFilesAllVersions(db, ids, sampleDirId)
      },
    },
    {
      name: 'recalculateCurrentForGroups:10k(loop)',
      category: 'write',
      run: withRollback(async (tx) => {
        const ids = await getLargeDir10kIds(tx)
        const placeholders = ids.map(() => '?').join(',')
        const groups = await tx.getAllAsync<{
          name: string
          directoryId: string | null
        }>(
          `SELECT DISTINCT name, directoryId FROM files WHERE id IN (${placeholders}) AND kind = 'file'`,
          ...ids,
        )
        await ops.recalculateCurrentForGroups(tx, groups)
      }),
    },
    {
      name: 'recalculateCurrentForFileIds:10k(bulk)',
      category: 'write',
      run: withRollback(async (tx) => {
        const ids = await getLargeDir10kIds(tx)
        await ops.recalculateCurrentForFileIds(tx, ids)
      }),
    },
  ]
}
