/*
 * A simulation of the library screen while uploads, thumbnails and sync-down
 * keep changing the library, run on the app's real read pool, its real list,
 * count and photo-viewer hooks, and the facade's real queries, over a database
 * the size of a 17k-photo library.
 *
 * It reproduces a freeze seen on an iPhone: the grid's "loading more" spinner
 * at the end of the loaded rows never went away, and the photo viewer never
 * let the user swipe, until the app restarted. Each library change makes every
 * mounted list and count reload, and these checks fail when the reloads stack
 * up faster than the two read connections drain them.
 *
 * expo-sqlite-mock runs each statement synchronously on better-sqlite3, so on
 * its own a query costs no simulated time and holds no read connection. The
 * model below lets the statement run for real, then holds its result for the
 * time a phone takes, under fake timers. The phone-to-this-machine ratio comes
 * from the two queries the phone's log timed: the upload poll's candidate
 * query took 2.9 to 3.0s and the waiting-to-upload count 1.6s on average. Every
 * statement is scaled by that ratio, which assumes the phone is slower by the
 * same factor for each query.
 */
import { AppProvider } from '@siastorage/core/app'
import { DEFAULT_INDEXER_URL } from '@siastorage/core/config'
import {
  type FileListParams,
  useFileList,
  useLibraryCount,
  useLoadMore,
  useMediaCount,
} from '@siastorage/core/stores'
import { act, renderHook } from '@testing-library/react-native'
import * as SQLite from 'expo-sqlite'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { ReactNode } from 'react'
import { db, initializeDB } from '../db'
import { app } from './appService'
import { useFileCarousel } from './fileCarousel'
import { useUploadProgress } from './uploads'

// The library from the phone's log: 16,716 photo and video originals with two
// thumbnail sizes each, all but two uploaded, and a full 4GB file cache,
// modeled as every thumbnail and about 2,000 photos at 2MB.
const ORIGINALS = 16_716
const CACHED_ORIGINALS = 2_000
const NOT_UPLOADED = 2

// Phone timings from the log for the two queries used to calibrate the model.
const PHONE_UPLOAD_POLL_MS = 2_950
const PHONE_LOCAL_ONLY_COUNT_MS = 1_600

// The upload manager's poll interval (PACKER_POLL_INTERVAL outside sim).
const UPLOAD_POLL_MS = 5_000

const STEP_MS = 100

// Each run gets its own list scope, so it starts without the pages the run
// before it loaded.
const filters = (scope: string): FileListParams => ({
  scope,
  sortBy: 'DATE',
  sortDir: undefined,
  categories: ['Video', 'Image'],
})

let dir: string
let phoneFactor = 1
let modelOn = false

type Counters = {
  requested: number
  started: number
  finished: number
  pageReads: number
  heavyReads: number
}
const counters: Counters = { requested: 0, started: 0, finished: 0, pageReads: 0, heavyReads: 0 }

const READ_METHODS = ['getAllAsync', 'getFirstAsync'] as const
const MODELED_METHODS = ['getAllAsync', 'getFirstAsync', 'runAsync', 'execAsync'] as const

function realMs(start: bigint): number {
  return Number(process.hrtime.bigint() - start) / 1e6
}

function isPageRead(sql: string): boolean {
  return sql.includes('isFavorite') || sql.includes('FROM objects WHERE fileId IN')
}

function isHeavyRead(sql: string): boolean {
  return sql.includes('NOT EXISTS (SELECT 1 FROM objects s')
}

// A statement's first timing on this machine, reused for every later run of
// the same statement and parameters, so timing noise here does not become
// noise in the phone's timeline after scaling.
const costs = new Map<string, number>()

// Each statement runs for real, then its result is held for the phone's time.
function installPhoneModel() {
  const proto = SQLite.SQLiteDatabase.prototype as unknown as Record<
    string,
    (...args: unknown[]) => Promise<unknown>
  >
  for (const method of MODELED_METHODS) {
    const original = proto[method]
    proto[method] = async function (this: unknown, ...args: unknown[]) {
      if (!modelOn) return original.apply(this, args)
      const sql = typeof args[0] === 'string' ? args[0] : ''
      const isRead = (READ_METHODS as readonly string[]).includes(method)
      if (isRead) {
        counters.started++
        if (isPageRead(sql)) counters.pageReads++
        if (isHeavyRead(sql)) counters.heavyReads++
      }
      const start = process.hrtime.bigint()
      const result = await original.apply(this, args)
      const key = JSON.stringify(args)
      const cost = costs.get(key) ?? realMs(start)
      costs.set(key, cost)
      await new Promise((r) => setTimeout(r, cost * phoneFactor))
      if (isRead) counters.finished++
      return result
    }
  }
}

// Reads the app asked for, counted before the pool picks a connection.
function countRequestedReads() {
  const adapter = db() as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>
  for (const method of READ_METHODS) {
    const original = adapter[method]
    adapter[method] = (...args: unknown[]) => {
      if (modelOn) counters.requested++
      return original(...args)
    }
  }
}

async function seed() {
  const now = Date.UTC(2026, 9, 27)
  const indexerURL = DEFAULT_INDEXER_URL
  await db().withTransactionAsync(async (tx) => {
    for (let i = 0; i < ORIGINALS; i++) {
      const id = `f${i}`
      const createdAt = now - i * 60_000
      const isVideo = i % 13 === 0
      await tx.runAsync(
        `INSERT INTO files (id, addedAt, name, size, type, kind, createdAt, updatedAt, hash, nameSortKey, current)
         VALUES (?, ?, ?, ?, ?, 'file', ?, ?, ?, ?, 1)`,
        id,
        createdAt,
        `IMG_${i}.${isVideo ? 'mov' : 'heic'}`,
        isVideo ? 40_000_000 : 2_000_000,
        isVideo ? 'video/quicktime' : 'image/heic',
        createdAt,
        createdAt,
        `sha256:${id}`,
        `img_${String(i).padStart(6, '0')}`,
      )
      for (const size of [64, 512]) {
        const thumbId = `${id}-t${size}`
        await tx.runAsync(
          `INSERT INTO files (id, addedAt, name, size, type, kind, createdAt, updatedAt, hash, thumbForId, thumbSize, current)
           VALUES (?, ?, ?, ?, 'image/webp', 'thumb', ?, ?, ?, ?, ?, 1)`,
          thumbId,
          createdAt,
          `${thumbId}.webp`,
          size * 40,
          createdAt,
          createdAt,
          `sha256:${thumbId}`,
          id,
          size,
        )
        await tx.runAsync(
          'INSERT INTO fs (fileId, size, addedAt, usedAt) VALUES (?, ?, ?, ?)',
          thumbId,
          size * 40,
          createdAt,
          createdAt,
        )
      }
      const uploaded = i >= NOT_UPLOADED
      const ids = uploaded ? [id, `${id}-t64`, `${id}-t512`] : []
      for (const fileId of ids) {
        await tx.runAsync(
          `INSERT INTO objects (fileId, indexerURL, id, slabs, encryptedDataKey, encryptedMetadataKey,
             encryptedMetadata, dataSignature, metadataSignature, createdAt, updatedAt)
           VALUES (?, ?, ?, '[]', '', '', '', '', '', ?, ?)`,
          fileId,
          indexerURL,
          `obj-${fileId}`,
          createdAt,
          createdAt,
        )
      }
      if (i < CACHED_ORIGINALS) {
        await tx.runAsync(
          'INSERT INTO fs (fileId, size, addedAt, usedAt) VALUES (?, ?, ?, ?)',
          id,
          2_000_000,
          createdAt,
          createdAt,
        )
      }
    }
  })
  await db().execAsync('ANALYZE')
}

// The two queries the phone logged as slow, issued the way the app issues
// them: the upload manager's candidate poll and the header's count of files
// waiting to upload.
async function uploadPoll() {
  return app().files.query({
    limit: 200,
    order: 'ASC',
    pinned: { indexerURL: DEFAULT_INDEXER_URL, isPinned: false },
    fileExistsLocally: true,
    includeThumbnails: true,
  })
}

// The same two queries as the phone ran them, copied from its log, so the
// calibration holds when the app's queries change.
const RECORD_FILTER = (t: string) =>
  `((${t}.kind = 'file' AND ${t}.current = 1) OR (${t}.kind = 'thumb' AND EXISTS (SELECT 1 FROM files o WHERE o.id = ${t}.thumbForId AND o.current = 1 AND o.trashedAt IS NULL AND o.deletedAt IS NULL))) AND ${t}.trashedAt IS NULL AND ${t}.deletedAt IS NULL AND NOT EXISTS (SELECT 1 FROM objects s WHERE s.fileId = ${t}.id AND s.indexerURL = ?) AND EXISTS (SELECT 1 FROM fs fsMeta WHERE fsMeta.fileId = ${t}.id)`
const PHONE_UPLOAD_POLL_SQL = `SELECT f.id, f.name, f.size, f.createdAt, f.updatedAt, f.type, f.kind, f.mediaAssetId, f.hash, f.addedAt, f.thumbForId, f.thumbSize, f.trashedAt, f.deletedAt, f.lostReason, o.fileId as fileId, o.indexerURL as indexerURL, o.id as objectId, o.createdAt as objectCreatedAt, o.updatedAt as objectUpdatedAt FROM files f LEFT JOIN objects o ON o.fileId = f.id WHERE ${RECORD_FILTER('f')} ORDER BY f.createdAt ASC, f.id ASC LIMIT 200`
const PHONE_LOCAL_ONLY_COUNT_SQL = `SELECT COUNT(*) as count, COALESCE(SUM(size), 0) as totalBytes FROM files WHERE ${RECORD_FILTER('files')}`

async function medianMs(run: () => Promise<unknown>): Promise<number> {
  const times: number[] = []
  for (let i = 0; i < 5; i++) {
    const start = process.hrtime.bigint()
    await run()
    times.push(realMs(start))
  }
  times.sort((a, b) => a - b)
  return times[2]
}

function wrapper({ children }: { children: ReactNode }) {
  return <AppProvider value={app()}>{children}</AppProvider>
}

// The hooks the library screen has mounted with the grid open: its own copy
// of the list, the grid's copy with its scroll controls, the two header
// counts, and the upload indicator.
function useLibraryScreen(scope: string) {
  const screenList = useFileList(filters(scope))
  const gridList = useFileList(filters(scope))
  const controls = useLoadMore(gridList)
  useLibraryCount()
  useMediaCount()
  useUploadProgress()
  return { screenList, gridList, controls }
}

async function advance(ms: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms)
  })
}

// Advances until `done` holds, and returns the simulated time it took, or
// null when it did not happen within `limitMs`.
async function timeUntil(done: () => boolean, limitMs: number, onStep?: () => void) {
  for (let t = 0; t <= limitMs; t += STEP_MS) {
    if (done()) return t
    await advance(STEP_MS)
    onStep?.()
  }
  return null
}

type Result = {
  changeEveryMs: number
  pageMs: number | null
  viewerMs: number | null
  maxWaiting: number
  requested: number
  pageReads: number
  heavyReads: number
}

async function simulate(changeEveryMs: number): Promise<Result> {
  for (const key of Object.keys(counters) as (keyof Counters)[]) counters[key] = 0
  const screen = await renderHook(() => useLibraryScreen(`library-${changeEveryMs}`), {
    wrapper,
  })
  const grid = () => screen.result.current

  // The user scrolls through four pages while the library is quiet.
  for (let page = 1; page <= 4; page++) {
    const loaded = await timeUntil(() => (grid().gridList.data?.length ?? 0) >= page * 40, 30_000)
    if (loaded === null) throw new Error(`page ${page} never loaded with the library quiet`)
    if (page < 4) await act(async () => grid().controls.loadMore())
  }

  let stopped = false
  let pollStopped = false
  void (async () => {
    while (!stopped) {
      await uploadPoll().catch(() => {})
      await new Promise((r) => setTimeout(r, UPLOAD_POLL_MS))
    }
    pollStopped = true
  })()
  // What syncDownEvents does after applying each batch, and what the
  // uploader and thumbnail scanner do after each file.
  const changes = setInterval(() => {
    app().caches.library.invalidateAll()
    app().caches.directories.invalidateAll()
    app().caches.libraryVersion.invalidate()
  }, changeEveryMs)

  let maxWaiting = 0
  const sample = () => {
    maxWaiting = Math.max(maxWaiting, counters.requested - counters.started)
  }

  await timeUntil(() => false, 10_000, sample)

  // The user reaches the end of the loaded rows.
  await act(async () => grid().controls.loadMore())
  const pageMs = await timeUntil(
    () => (grid().gridList.data?.length ?? 0) >= 200 && !grid().controls.isLoadingMore,
    60_000,
    sample,
  )

  // The user opens a photo from the grid.
  const opened = grid().gridList.data![150]
  const viewer = await renderHook(
    () =>
      useFileCarousel({
        initialId: opened.id,
        initialFile: opened,
        sortBy: 'DATE',
        categories: ['Video', 'Image'],
      }),
    { wrapper },
  )
  const viewerMs = await timeUntil(() => viewer.result.current.totalCount > 1, 60_000, sample)

  stopped = true
  clearInterval(changes)
  await viewer.unmount()
  await screen.unmount()
  // Lets the work still queued finish before the next run starts.
  await timeUntil(() => pollStopped && counters.requested === counters.finished, 600_000)

  return {
    changeEveryMs,
    pageMs,
    viewerMs,
    maxWaiting,
    requested: counters.requested,
    pageReads: counters.pageReads,
    heavyReads: counters.heavyReads,
  }
}

function report(results: Result[]) {
  if (!process.env.PILEUP_REPORT) return
  const fmt = (ms: number | null) => (ms === null ? 'never' : `${(ms / 1000).toFixed(1)}s`)
  const lines = results.map(
    (r) =>
      `change every ${(r.changeEveryMs / 1000).toFixed(1)}s: next page ${fmt(r.pageMs)}, ` +
      `viewer swipe ${fmt(r.viewerMs)}, max reads waiting ${r.maxWaiting}, ` +
      `reads ${r.requested} (page ${r.pageReads}, heavy ${r.heavyReads})`,
  )
  console.log([`phone factor ${phoneFactor.toFixed(0)}x`, ...lines].join('\n'))
}

describe('library reads while the library keeps changing', () => {
  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'read-pileup-'))
    process.env.EXPO_SQLITE_MOCK = path.join(dir, 'app.db')
    countRequestedReads()
    installPhoneModel()
    await initializeDB({ databaseName: 'app.db' })
    await seed()
    const pollMs = await medianMs(() =>
      db().getAllAsync(PHONE_UPLOAD_POLL_SQL, DEFAULT_INDEXER_URL),
    )
    const countMs = await medianMs(() =>
      db().getFirstAsync(PHONE_LOCAL_ONLY_COUNT_SQL, DEFAULT_INDEXER_URL),
    )
    phoneFactor = (PHONE_UPLOAD_POLL_MS / pollMs + PHONE_LOCAL_ONLY_COUNT_MS / countMs) / 2
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'hrtime'] })
    modelOn = true
  })

  afterAll(() => {
    modelOn = false
    jest.useRealTimers()
    delete process.env.EXPO_SQLITE_MOCK
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('loads the next page and lets the viewer swipe while the library keeps changing', async () => {
    // The two rates from the phone's log: sync-down applying a 500-event batch
    // every 1.1s while catching up, and a change every 3.6s after launch.
    const results = [await simulate(3_600), await simulate(1_100)]
    report(results)
    for (const r of results) {
      expect(r.maxWaiting).toBeLessThan(50)
      expect(r.pageMs).not.toBeNull()
      expect(r.pageMs!).toBeLessThan(8_000)
      expect(r.viewerMs).not.toBeNull()
      expect(r.viewerMs!).toBeLessThan(5_000)
    }
  }, 180_000)
})
