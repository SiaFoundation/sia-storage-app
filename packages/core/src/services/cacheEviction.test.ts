import type { AppService } from '../app/service'
import { runCacheEviction } from './cacheEviction'

type Row = { fileId: string; size: number; type: string }

/**
 * A facade with only what runCacheEviction touches. Rows sit in pass 3 alone,
 * and `objects` maps a file to the indexers holding an object for it.
 */
function fakeApp(opts: { rows: Row[]; objects: Record<string, string[]>; indexer: () => string }) {
  const removed: string[] = []
  const app = {
    fs: {
      calcTotalSize: async () => opts.rows.reduce((sum, r) => sum + r.size, 0),
      trashedCachedFiles: async () => [],
      nonCurrentCachedFiles: async () => [],
      evictionCandidates: async (indexerURL: string, _threshold: number, limit: number) =>
        opts.rows
          .filter((r) => !removed.includes(r.fileId))
          .filter((r) => opts.objects[r.fileId]?.includes(indexerURL))
          .slice(0, limit),
      removeFile: async (file: { id: string }) => {
        removed.push(file.id)
      },
    },
    settings: { getIndexerURL: async () => opts.indexer() },
    localObjects: {
      countForFileOnIndexer: async (fileId: string, indexerURL: string) =>
        opts.objects[fileId]?.includes(indexerURL) ? 1 : 0,
    },
    caches: {
      library: { invalidateAll: async () => {} },
      libraryVersion: { invalidate: () => {} },
    },
  } as unknown as AppService
  return { app, removed }
}

describe('runCacheEviction', () => {
  it('re-checks the indexer before each removal, so a switch mid-batch keeps the rest', async () => {
    let indexer = 'https://old.example.com'
    const rows = ['a', 'b', 'c'].map((fileId) => ({ fileId, size: 10, type: 'text/plain' }))
    const { app, removed } = fakeApp({
      rows,
      objects: { a: [indexer], b: [indexer], c: [indexer, 'https://new.example.com'] },
      indexer: () => indexer,
    })
    const removeFile = app.fs.removeFile
    app.fs.removeFile = async (file) => {
      await removeFile(file)
      // The user switches indexer while the first batch is being removed.
      indexer = 'https://new.example.com'
    }

    await runCacheEviction(app, { maxBytes: 0, minAge: 0 })

    expect(removed).toEqual(['a', 'c'])
  })
})
