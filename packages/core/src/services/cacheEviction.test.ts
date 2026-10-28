import type { AppService } from '../app/service'
import type { EvictionCursor, EvictionRow } from '../db/operations'
import { runCacheEviction } from './cacheEviction'

/**
 * A facade with only what runCacheEviction touches. Rows sit in pass 3 alone,
 * and `objects` maps a file to the indexers holding an object for it. The
 * candidate query pages by (usedAt, fileId) the way the real one does.
 */
function fakeApp(opts: {
  rows: EvictionRow[]
  objects: Record<string, string[]>
  indexer: () => string
  failing?: Set<string>
}) {
  const removed: string[] = []
  const attempts: string[] = []
  const after = (row: EvictionRow, cursor: EvictionCursor | null) =>
    !cursor ||
    row.usedAt > cursor.usedAt ||
    (row.usedAt === cursor.usedAt && row.fileId > cursor.fileId)
  const app = {
    fs: {
      calcTotalSize: async () => opts.rows.reduce((sum, r) => sum + r.size, 0),
      trashedCachedFiles: async () => [],
      nonCurrentCachedFiles: async () => [],
      evictionCandidates: async (
        indexerURL: string,
        _threshold: number,
        cursor: EvictionCursor | null,
        limit: number,
      ) => {
        // A pass whose cursor stops advancing reads the same rows forever and
        // never yields to Jest's timeout, so it fails here instead of running
        // the worker out of memory.
        if (attempts.length > opts.rows.length * 2) {
          throw new Error('the pass read rows it had already tried')
        }
        return opts.rows
          .filter((r) => !removed.includes(r.fileId))
          .filter((r) => opts.objects[r.fileId]?.includes(indexerURL))
          .filter((r) => after(r, cursor))
          .sort((a, b) => a.usedAt - b.usedAt || a.fileId.localeCompare(b.fileId))
          .slice(0, limit)
      },
      removeFile: async (file: { id: string }) => {
        attempts.push(file.id)
        if (opts.failing?.has(file.id)) throw new Error('cannot delete')
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
  return { app, removed, attempts }
}

const INDEXER = 'https://indexer.example.com'

function rows(prefix: string, count: number, usedAt: number): EvictionRow[] {
  return Array.from({ length: count }, (_, i) => ({
    fileId: `${prefix}${String(i).padStart(3, '0')}`,
    size: 10,
    type: 'text/plain',
    usedAt,
  }))
}

function onIndexer(list: EvictionRow[]): Record<string, string[]> {
  return Object.fromEntries(list.map((r) => [r.fileId, [INDEXER]]))
}

describe('runCacheEviction', () => {
  it('re-checks the indexer before each removal, so a switch mid-batch keeps the rest', async () => {
    let indexer = 'https://old.example.com'
    const list = rows('f', 3, 1000)
    const { app, removed } = fakeApp({
      rows: list,
      objects: { f000: [indexer], f001: [indexer], f002: [indexer, 'https://new.example.com'] },
      indexer: () => indexer,
    })
    const removeFile = app.fs.removeFile
    app.fs.removeFile = async (file) => {
      await removeFile(file)
      // The user switches indexer while the first batch is being removed.
      indexer = 'https://new.example.com'
    }

    await runCacheEviction(app, { maxBytes: 0, minAge: 0 })

    expect(removed).toEqual(['f000', 'f002'])
  })

  it('tries each candidate once per pass when every removal fails', async () => {
    const list = rows('f', 150, 1000)
    const { app, attempts } = fakeApp({
      rows: list,
      objects: onIndexer(list),
      indexer: () => INDEXER,
      failing: new Set(list.map((r) => r.fileId)),
    })

    const result = await runCacheEviction(app, { maxBytes: 0, minAge: 0 })

    expect(attempts).toHaveLength(150)
    expect(new Set(attempts).size).toBe(150)
    expect(result?.evicted).toBe(0)
  })

  it('reaches removable candidates behind a run of failing ones', async () => {
    const stuck = rows('a', 150, 1000)
    const good = rows('b', 10, 2000)
    const { app, removed } = fakeApp({
      rows: [...stuck, ...good],
      objects: onIndexer([...stuck, ...good]),
      indexer: () => INDEXER,
      failing: new Set(stuck.map((r) => r.fileId)),
    })

    // 160 files of 10 bytes are cached, so five must go to reach the cap.
    await runCacheEviction(app, { maxBytes: 1_550, minAge: 0 })

    expect(removed).toEqual(good.slice(0, 5).map((r) => r.fileId))
  })
})
