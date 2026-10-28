import type { AppService } from '../app/service'
import type { EvictionCursor, EvictionRow } from '../db/operations'
import {
  type CacheEvictionConfig,
  type CacheEvictionResult,
  EVICT_ALL_BACKED_UP,
  evictionRunner,
  runCacheEviction,
} from './cacheEviction'

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
  locked?: Set<string>
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
      removeFile: async (file: { id: string }, removeOpts?: { skipIfLocked?: boolean }) => {
        attempts.push(file.id)
        if (opts.failing?.has(file.id)) throw new Error('cannot delete')
        if (removeOpts?.skipIfLocked && opts.locked?.has(file.id)) return false
        removed.push(file.id)
        return true
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
    app.fs.removeFile = async (file, removeOpts) => {
      const removedNow = await removeFile(file, removeOpts)
      // The user switches indexer while the first batch is being removed.
      indexer = 'https://new.example.com'
      return removedNow
    }

    await runCacheEviction(app, { maxBytes: 0, minAge: 0 })

    expect(removed).toEqual(['f000', 'f002'])
  })

  it('skips a file being downloaded or exported, and does not count it as freed', async () => {
    const list = rows('f', 3, 1000)
    const { app, removed } = fakeApp({
      rows: list,
      objects: onIndexer(list),
      indexer: () => INDEXER,
      locked: new Set(['f000']),
    })

    const result = await runCacheEviction(app, { maxBytes: 0, minAge: 0 })

    expect(removed).toEqual(['f001', 'f002'])
    expect(result?.evicted).toBe(2)
    expect(result?.currentSize).toBe(10)
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

describe('evictionRunner stopping', () => {
  /** A pass that waits for its signal to abort, recording each signal it ran with. */
  function passUntilAborted() {
    const signals: AbortSignal[] = []
    const run = (signal: AbortSignal) => {
      signals.push(signal)
      return new Promise<undefined>((resolve) => {
        if (signal.aborted) resolve(undefined)
        signal.addEventListener('abort', () => resolve(undefined), { once: true })
      })
    }
    return { run, signals }
  }

  it('stops a pass a socket request started when the scheduler joins it and then aborts', async () => {
    const pass = passUntilAborted()
    const eviction = evictionRunner(
      (_config, signal) => pass.run(signal),
      async () => ({}),
    )
    const fromSocket = eviction.evict()
    const scheduler = new AbortController()

    const joined = eviction.evict(scheduler.signal)
    scheduler.abort()
    await Promise.all([fromSocket, joined])

    expect(pass.signals).toHaveLength(1)
    expect(pass.signals[0].aborted).toBe(true)
  })

  it('refuses a pass asked for after stop', async () => {
    const pass = passUntilAborted()
    const eviction = evictionRunner(
      (_config, signal) => pass.run(signal),
      async () => ({}),
    )
    await eviction.stop()

    await expect(eviction.evict()).resolves.toBeUndefined()
    expect(pass.signals).toHaveLength(0)
  })

  it('stop aborts the running pass and resolves once it has ended', async () => {
    const pass = passUntilAborted()
    const eviction = evictionRunner(
      (_config, signal) => pass.run(signal),
      async () => ({}),
    )
    const running = eviction.evict()

    await eviction.stop()

    expect(pass.signals[0].aborted).toBe(true)
    await expect(running).resolves.toBeUndefined()
  })
})

describe('evictionRunner', () => {
  const SCHEDULED: CacheEvictionConfig = { maxBytes: 4_000, minAge: 1_000 }

  /** A pass that runs until released, recording the config it ran with. */
  function heldPasses() {
    const started: CacheEvictionConfig[] = []
    const releases: Array<() => void> = []
    const run = async (config: CacheEvictionConfig): Promise<CacheEvictionResult> => {
      started.push(config)
      await new Promise<void>((resolve) => releases.push(resolve))
      return {
        processedRows: 0,
        evicted: started.length,
        evictedFileIds: [],
        bytesFreed: 0,
        currentSize: 0,
      }
    }
    const releaseNext = async () => {
      while (releases.length === 0) await new Promise((r) => setTimeout(r, 1))
      releases.shift()!()
    }
    return { run, started, releaseNext }
  }

  it("gives an evict during a clear that clear's result", async () => {
    const passes = heldPasses()
    const runner = evictionRunner(passes.run, async () => SCHEDULED)

    const cleared = runner.clear()
    const evicted = runner.evict()
    await passes.releaseNext()

    expect(await evicted).toBe(await cleared)
    expect(passes.started).toEqual([EVICT_ALL_BACKED_UP])
  })

  it('runs a clear after a scheduled pass already running, with nothing spared', async () => {
    const passes = heldPasses()
    const runner = evictionRunner(passes.run, async () => SCHEDULED)

    const scheduled = runner.evict()
    const cleared = runner.clear()
    await passes.releaseNext()
    await scheduled
    await passes.releaseNext()

    expect((await cleared)?.evicted).toBe(2)
    expect(passes.started).toEqual([SCHEDULED, EVICT_ALL_BACKED_UP])
  })

  it("gives a second clear the running clear's result", async () => {
    const passes = heldPasses()
    const runner = evictionRunner(passes.run, async () => SCHEDULED)

    const first = runner.clear()
    const second = runner.clear()
    await passes.releaseNext()

    expect(await second).toBe(await first)
    expect(passes.started).toHaveLength(1)
  })
})
