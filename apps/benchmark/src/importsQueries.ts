import type { DatabaseAdapter } from '@siastorage/core/adapters'
import type { AppService } from '@siastorage/core/app'
import type { ImportScanner } from '@siastorage/core/services/importScanner'
import { ARCHIVE_DIR_ID, ARCHIVE_IMPORT_ID, IMPORTS_INDEXER_URL } from './importsDataset'
import type { QuerySpec } from './types'

/*
 * The imports drain scenario's measured cases.
 *
 * The reads are the exact refetch shapes the mobile hooks run when the imports
 * cache invalidates; `importsRefetchCycle` strings them together as one cycle,
 * which during a drain recurs about once per second.
 *
 * The harness runs every spec sequentially on one connection, so these measure
 * query and queue cost. They say nothing about contention, which is what makes
 * the app slow under a real drain: a benchmark that reproduced that would have
 * to be the app.
 */
export function buildImportQuerySpecs(
  app: AppService,
  db: DatabaseAdapter,
  allImportIds: string[],
  scanner: ImportScanner,
): QuerySpec[] {
  function withRollback(fn: () => Promise<unknown>): () => Promise<unknown> {
    return async () => {
      await db.execAsync('SAVEPOINT bench_imports')
      try {
        return await fn()
      } finally {
        await db.execAsync('ROLLBACK TO bench_imports')
        await db.execAsync('RELEASE bench_imports')
      }
    }
  }

  const specs: QuerySpec[] = [
    {
      name: 'imports.list',
      category: 'imports-read',
      run: () => app.imports.list(),
    },
    {
      name: 'imports.summary:allIds',
      category: 'imports-read',
      run: () => app.imports.summary(allImportIds),
    },
    {
      name: 'imports.summary:archiveOnly',
      category: 'imports-read',
      run: () => app.imports.summary([ARCHIVE_IMPORT_ID]),
    },
    {
      name: 'imports.countInFlight:global',
      category: 'imports-read',
      run: () => app.imports.countInFlight(),
    },
    {
      name: 'imports.countInFlight:directory',
      category: 'imports-read',
      run: () => app.imports.countInFlight(ARCHIVE_DIR_ID),
    },
    {
      name: 'imports.files:archive:limit100',
      category: 'imports-read',
      run: () => app.imports.files(ARCHIVE_IMPORT_ID, { limit: 100 }),
    },
    {
      name: 'imports.pendingFiles:20',
      category: 'imports-read',
      run: () => app.imports.pendingFiles(20, Date.now()),
    },
    // The uploader-side aggregate a library invalidation refetches. No index
    // in this diff touches it, so it doubles as the run-to-run noise floor:
    // a delta here between arms is noise, not signal.
    {
      name: 'stats.uploadStats',
      category: 'imports-read',
      run: () => app.stats.uploadStats(IMPORTS_INDEXER_URL),
    },
  ]

  specs.push(
    {
      name: 'imports.listWithSummary:page30',
      category: 'imports-read',
      run: () => app.imports.listWithSummary({ limit: 30 }),
    },
    // What a user who scrolls their whole history into the list pays: the
    // aggregate walks the children of every import in the page, and nothing
    // prunes import_files.
    {
      name: 'imports.listWithSummary:unpaged',
      category: 'imports-read',
      run: () => app.imports.listWithSummary(),
    },
  )

  specs.push(
    {
      name: 'resetStaleImportFiles',
      category: 'imports-write',
      run: withRollback(() => app.imports.resetStale(10 * 60 * 1000, 3 * 60 * 1000, Date.now())),
    },
    {
      name: 'importsRefetchCycle',
      category: 'imports-scenario',
      run: async () => {
        await app.imports.listWithSummary({ limit: 30 })
        await app.imports.countInFlight()
        await app.imports.countInFlight(ARCHIVE_DIR_ID)
        await app.imports.inProgressImport('library-scan')
        return app.imports.files(ARCHIVE_IMPORT_ID, { limit: 100 })
      },
    },
    // One tick of the real ImportScanner against the mid-drain archive: its
    // own claim/copy/hash/finalize traffic, not a hand-written imitation of
    // it. The stub fsIO moves no bytes, so what is measured is the DB work a
    // tick issues, which is what the indexes change.
    {
      name: 'importScannerTick',
      category: 'imports-scenario',
      run: withRollback(() => scanner.runScan()),
    },
  )

  return specs
}
