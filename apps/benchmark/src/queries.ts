import type { DatabaseAdapter } from '@siastorage/core/adapters'
import type { AppService } from '@siastorage/core/app'
import * as ops from '@siastorage/core/db/operations'
import { INDEXER_URL } from './dataset'
import type { QuerySpec } from './types'

export function buildQuerySpecs(
  app: AppService,
  sampleDirId: string,
  sampleTagId: string,
  sampleFileId: string,
): QuerySpec[] {
  return [
    // Library counts
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

    // Pagination
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

    // Stats
    {
      name: 'uploadStats',
      category: 'stats',
      run: () => app.stats.uploadStats(INDEXER_URL),
    },

    // Directories
    {
      name: 'allDirectoriesWithCounts',
      category: 'directories',
      run: () => app.directories.getAll(),
    },

    // Thumbnails
    {
      name: 'thumbnailCandidatePage',
      category: 'thumbnails',
      run: () => app.thumbnails.queryCandidatePage(50),
    },
    {
      name: 'thumbnailScanProgress',
      category: 'thumbnails',
      run: () => app.thumbnails.queryProgress(),
    },
  ]
}

/**
 * Write benchmarks for version group operations. Operations that don't open
 * their own transactions use SAVEPOINT for rollback. Operations that use
 * withTransactionAsync (trash, move) undo their mutations after measurement.
 */
export function buildWriteQuerySpecs(db: DatabaseAdapter, sampleDirId: string): QuerySpec[] {
  function withRollback(fn: () => Promise<unknown>): () => Promise<unknown> {
    return async () => {
      await db.execAsync('SAVEPOINT bench_write')
      try {
        return await fn()
      } finally {
        await db.execAsync('ROLLBACK TO bench_write')
        await db.execAsync('RELEASE bench_write')
      }
    }
  }

  // Pre-query large sets of file IDs for directory-scale benchmarks.
  // dir-0000 contains ~12k files at scale=1 (682k groups / 55 dir slots).
  let largeDir10kIds: string[] | null = null
  async function getLargeDir10kIds(): Promise<string[]> {
    if (largeDir10kIds) return largeDir10kIds
    const rows = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM files WHERE directoryId = ? AND kind = 'file' LIMIT 10000`,
      sampleDirId,
    )
    largeDir10kIds = rows.map((r) => r.id)
    return largeDir10kIds
  }

  return [
    {
      name: 'recalculateCurrentForGroup:single',
      category: 'write',
      run: withRollback(() => ops.recalculateCurrentForGroup(db, 'vgroup-100v-0.pdf', sampleDirId)),
    },
    {
      name: 'recalculateCurrentForFileIds:500',
      category: 'write',
      run: withRollback(async () => {
        const ids = Array.from({ length: 500 }, (_, i) => `f-${i * 100}`)
        await ops.recalculateCurrentForFileIds(db, ids)
      }),
    },
    {
      name: 'recalculateCurrentForFileIds:10k',
      category: 'write',
      run: withRollback(async () => {
        const ids = Array.from({ length: 10_000 }, (_, i) => `f-${i * 10}`)
        await ops.recalculateCurrentForFileIds(db, ids)
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
      name: 'moveFilesToDirectory:1k',
      category: 'write',
      run: async () => {
        const ids = Array.from({ length: 1000 }, (_, i) => `f-${i}`)
        await ops.moveFilesToDirectory(db, ids, 'dir-0049')
        await ops.moveFilesToDirectory(db, ids, sampleDirId)
      },
    },
    {
      name: 'upsertManyFiles:500',
      category: 'write',
      run: withRollback(async () => {
        const now = Date.now()
        const records = Array.from({ length: 500 }, (_, i) => ({
          id: `upsert-${i}`,
          name: `upsert-bench-${i}.jpg`,
          type: 'image/jpeg',
          kind: 'file' as const,
          size: 1000 + i,
          hash: `upsert-hash-${i}`,
          createdAt: now,
          updatedAt: now,
          localId: null,
          addedAt: now,
          thumbForId: undefined,
          thumbSize: undefined,
          trashedAt: null,
          deletedAt: null,
        }))
        await ops.upsertManyFiles(db, records, {
          skipCurrentRecalc: true,
        })
      }),
    },
    {
      name: 'moveFilesToDirectory:10k',
      category: 'write',
      run: async () => {
        const ids = await getLargeDir10kIds()
        await ops.moveFilesToDirectory(db, ids, 'dir-0049')
        await ops.moveFilesToDirectory(db, ids, sampleDirId)
      },
    },
    {
      name: 'recalculateCurrentForGroups:10k(loop)',
      category: 'write',
      run: withRollback(async () => {
        const ids = await getLargeDir10kIds()
        const placeholders = ids.map(() => '?').join(',')
        const groups = await db.getAllAsync<{
          name: string
          directoryId: string | null
        }>(
          `SELECT DISTINCT name, directoryId FROM files WHERE id IN (${placeholders}) AND kind = 'file'`,
          ...ids,
        )
        await ops.recalculateCurrentForGroups(db, groups)
      }),
    },
    {
      name: 'recalculateCurrentForFileIds:10k(bulk)',
      category: 'write',
      run: withRollback(async () => {
        const ids = await getLargeDir10kIds()
        await ops.recalculateCurrentForFileIds(db, ids)
      }),
    },
  ]
}
