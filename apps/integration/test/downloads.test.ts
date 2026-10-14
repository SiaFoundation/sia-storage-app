import {
  DEFAULT_MAX_DOWNLOADS,
  DOWNLOAD_PRESERVED_DISK_BYTES,
  INSUFFICIENT_SPACE_MESSAGE,
  MAX_DOWNLOADS_SETTING,
} from '@siastorage/core/config'
import { createEmptyIndexerStorage } from '@siastorage/sdk-mock'
import * as nodeFs from 'fs'
import { cache, serialize } from 'swr/_internal'
import { createTestApp, generateTestFiles, type TestApp, waitForCondition } from './app'

function appWithFreeSpace(freeBytes: number): TestApp {
  return createTestApp(createEmptyIndexerStorage(), {
    fsIO: {
      getDeviceSpace: async () => ({ freeBytes }),
      // Report the slot empty so execute() runs the space guard instead of its
      // already-on-disk early return (the mock's default size() returns a hit).
      size: async () => ({ value: null, error: 'not_found' }),
    },
  })
}

const INDEXER_URL = 'https://test.indexer'

async function setupDownloadableFile(
  app: TestApp,
  opts?: { startId?: number; sizeBytes?: number },
) {
  const [file] = await app.addFiles(
    generateTestFiles(1, {
      startId: opts?.startId ?? 1,
      sizeBytes: opts?.sizeBytes,
    }),
  )

  const filePath = file.uri.replace('file://', '')
  const fileBytes = nodeFs.readFileSync(filePath)
  const data = new Uint8Array(fileBytes)

  const stored = app.sdk.injectObject({
    metadata: {
      id: file.id,
      name: file.name,
      type: file.type,
      kind: 'file',
      size: file.size,
      hash: file.hash,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      trashedAt: null,
    },
    data,
  })

  const now = new Date()
  await app.app.localObjects.upsert({
    id: stored.id,
    fileId: file.id,
    indexerURL: INDEXER_URL,
    slabs: [],
    encryptedDataKey: new ArrayBuffer(32),
    encryptedMetadataKey: new ArrayBuffer(32),
    encryptedMetadata: new ArrayBuffer(0),
    dataSignature: new ArrayBuffer(64),
    metadataSignature: new ArrayBuffer(64),
    createdAt: now,
    updatedAt: now,
  })

  await app.removeFsFile(file.id, file.type)
  await app.app.fs.deleteMeta(file.id)

  return { file, stored }
}

describe('Downloads', () => {
  let app: TestApp

  beforeEach(async () => {
    app = createTestApp(createEmptyIndexerStorage())
    await app.start()
    app.pause()
  })

  afterEach(async () => {
    await app.shutdown()
  })

  it('checkSpaceFor allows the download when the space probe throws', async () => {
    const probing = createTestApp(createEmptyIndexerStorage(), {
      fsIO: {
        getDeviceSpace: async () => {
          throw new Error('probe failed')
        },
      },
    })
    await probing.start()
    probing.pause()
    try {
      // A size far past any real reserve would be refused on a working probe;
      // a throwing probe must fail open and allow it.
      expect(await probing.app.downloads.checkSpaceFor([Number.MAX_SAFE_INTEGER])).toBe(true)
    } finally {
      await probing.shutdown()
    }
  })

  it('checkSpaceFor refuses when the device lacks room for the files', async () => {
    const probing = appWithFreeSpace(DOWNLOAD_PRESERVED_DISK_BYTES + 1_000)
    await probing.start()
    probing.pause()
    try {
      // Only 1 KB free above the reserve, so a 10 KB file cannot fit.
      expect(await probing.app.downloads.checkSpaceFor([10_000])).toBe(false)
    } finally {
      await probing.shutdown()
    }
  })

  it('checkSpaceFor reserves the preserved floor on top of the file size', async () => {
    // Free space is exactly reserve + fileSize: the file fits with the reserve
    // intact, but one byte more eats into the reserve and is refused.
    const fileSize = 4_000
    const probing = appWithFreeSpace(DOWNLOAD_PRESERVED_DISK_BYTES + fileSize)
    await probing.start()
    probing.pause()
    try {
      expect(await probing.app.downloads.checkSpaceFor([fileSize])).toBe(true)
      expect(await probing.app.downloads.checkSpaceFor([fileSize + 1])).toBe(false)
    } finally {
      await probing.shutdown()
    }
  })

  it('downloadFile rejects with the message but sets no error badge when space is low', async () => {
    // Free space below the reserve, so the backstop refuses any download. It
    // rejects so an awaiting caller learns why, but clears the entry rather than
    // flipping it to 'error' (a background prefetch with no room is not a file
    // error). User-initiated paths precheck up front; this backstop is only hit
    // by programmatic/auto callers.
    const probing = appWithFreeSpace(DOWNLOAD_PRESERVED_DISK_BYTES - 1)
    await probing.start()
    probing.pause()
    try {
      const { file } = await setupDownloadableFile(probing)
      await expect(probing.app.downloads.downloadFile(file.id, 'user')).rejects.toThrow(
        INSUFFICIENT_SPACE_MESSAGE,
      )
      // No lingering error entry (no badge), and nothing landed on disk.
      expect(probing.app.downloads.getEntry(file.id)).toBeUndefined()
      expect(await probing.getFsFileUri({ id: file.id, type: file.type })).toBeNull()
    } finally {
      await probing.shutdown()
    }
  })

  it('downloads a file and writes it to disk', async () => {
    const { file } = await setupDownloadableFile(app)

    await app.app.downloads.downloadFile(file.id, 'user')

    const uri = await app.getFsFileUri({ id: file.id, type: file.type })
    expect(uri).not.toBeNull()

    const meta = await app.app.fs.readMeta(file.id)
    expect(meta).not.toBeNull()
    expect(meta!.size).toBe(file.size)

    const entry = app.app.downloads.getEntry(file.id)
    expect(entry?.status).toBe('done')
    expect(entry?.progress).toBe(1)
  })

  it('skips download if file already exists locally', async () => {
    const [file] = await app.addFiles(generateTestFiles(1, { startId: 1 }))

    await app.app.downloads.downloadFile(file.id, 'user')

    const entry = app.app.downloads.getEntry(file.id)
    expect(entry).toBeUndefined()

    const meta = await app.app.fs.readMeta(file.id)
    expect(meta).not.toBeNull()
    expect(meta!.size).toBe(file.size)
  })

  it('a download asked for a file already on the device tells the screens it is there', async () => {
    const [file] = await app.addFiles(generateTestFiles(1, { startId: 1 }))
    // Two separate conditions. A screen holds a stale "not on this device",
    // as a list query that read the file before its bytes arrived leaves it.
    // And the bytes are on disk with no fs row describing them.
    await app.app.caches.fsFileUri.set(null, file.id)
    await app.app.fs.deleteMeta(file.id)

    await app.app.downloads.downloadFile(file.id, 'user')

    const cached = cache.get(serialize(app.app.caches.fsFileUri.key(file.id))[0])?.data
    expect(cached).toBe(app.app.fs.uri(file))
    expect((await app.app.fs.readMeta(file.id))?.size).toBe(file.size)
    expect(app.app.downloads.getEntry(file.id)).toBeUndefined()
  })

  it('the transfers count is refreshed when a download starts, runs and finishes', async () => {
    const { file } = await setupDownloadableFile(app)
    const invalidate = jest.spyOn(app.app.caches.downloads, 'invalidate')

    await app.app.downloads.downloadFile(file.id, 'user')

    const countRefreshes = invalidate.mock.calls.filter(([key]) => key === 'counts')
    // Queued, then downloading, then done.
    expect(countRefreshes).toHaveLength(3)
  })

  it('deduplicates concurrent downloads for the same file', async () => {
    const { file } = await setupDownloadableFile(app)

    const [r1, r2] = await Promise.all([
      app.app.downloads.downloadFile(file.id, 'user'),
      app.app.downloads.downloadFile(file.id, 'user'),
    ])

    expect(r1).toBeUndefined()
    expect(r2).toBeUndefined()

    const entry = app.app.downloads.getEntry(file.id)
    expect(entry?.status).toBe('done')
  })

  it('throws if file record not found', async () => {
    await expect(app.app.downloads.downloadFile('nonexistent-id', 'user')).rejects.toThrow(
      'File record not found',
    )
  })

  it('throws if no local objects available', async () => {
    const [file] = await app.addFiles(generateTestFiles(1, { startId: 1 }))
    await app.removeFsFile(file.id, file.type)

    await expect(app.app.downloads.downloadFile(file.id, 'user')).rejects.toThrow(
      'No object available for download',
    )
  })

  it('throws if SDK not initialized', async () => {
    const { file } = await setupDownloadableFile(app)
    app.internal.setSdk(null)

    await expect(app.app.downloads.downloadFile(file.id, 'user')).rejects.toThrow(
      'SDK not initialized',
    )
  })

  it('setMaxSlots persists and applies', async () => {
    await app.app.downloads.setMaxSlots(5)
    expect(await app.app.settings.getMaxDownloads()).toBe(5)

    await app.app.downloads.setMaxSlots(0)
    expect(await app.app.settings.getMaxDownloads()).toBe(1)
  })

  it('an upgraded install with the old default saved runs at the new default, and startup saves nothing', async () => {
    await app.app.storage.setItem('maxDownloads', '2')

    await app.app.downloads.restoreMaxSlots()

    expect(await app.app.settings.getMaxDownloads()).toBe(DEFAULT_MAX_DOWNLOADS)
    expect(await app.app.storage.getItem('maxDownloads')).toBeNull()
    expect(await app.app.storage.getItem(MAX_DOWNLOADS_SETTING)).toBeNull()
  })

  it('with the saved count cleared, startup runs downloads at the default again, not the old count', async () => {
    await app.app.downloads.setMaxSlots(1)
    await app.app.storage.removeItem(MAX_DOWNLOADS_SETTING)
    await app.app.downloads.restoreMaxSlots()

    const first = await setupDownloadableFile(app, { startId: 1 })
    const second = await setupDownloadableFile(app, { startId: 2 })
    let unblock!: () => void
    const blocked = new Promise<void>((resolve) => {
      unblock = resolve
    })
    const download = app.sdk.downloadByObjectId.bind(app.sdk)
    jest.spyOn(app.sdk, 'downloadByObjectId').mockImplementation(async (objectId) => {
      if (objectId === first.stored.id) await blocked
      return download(objectId)
    })
    const holding = app.app.downloads.downloadFile(first.file.id, 'user')
    await waitForCondition(
      () => app.app.downloads.getEntry(first.file.id)?.status === 'downloading',
    )

    // With one slot this would wait behind the first.
    await app.app.downloads.downloadFile(second.file.id, 'user')
    unblock()
    await holding
  })

  it('an upgraded install keeps a download count it chose, other than the old default', async () => {
    await app.app.storage.setItem('maxDownloads', '4')

    await app.app.downloads.restoreMaxSlots()

    expect(await app.app.settings.getMaxDownloads()).toBe(4)
    expect(await app.app.storage.getItem('maxDownloads')).toBeNull()
  })

  it('a download count the user chose survives startup', async () => {
    await app.app.downloads.setMaxSlots(3)

    await app.app.downloads.restoreMaxSlots()

    expect(await app.app.settings.getMaxDownloads()).toBe(3)
  })

  it('progress reports file.size-based progress', async () => {
    const { file } = await setupDownloadableFile(app, { sizeBytes: 1024 })

    await app.app.downloads.downloadFile(file.id, 'user')

    const entry = app.app.downloads.getEntry(file.id)
    expect(entry?.progress).toBe(1)

    const meta = await app.app.fs.readMeta(file.id)
    expect(meta!.size).toBe(file.size)
  })
})

describe('Download priority', () => {
  let app: TestApp

  beforeEach(async () => {
    app = createTestApp(createEmptyIndexerStorage())
    await app.start()
    app.pause()
  })

  afterEach(async () => {
    await app.shutdown()
  })

  /**
   * Holds the only slot with one download, so everything after it waits in
   * the queue, and returns what the tests need to fill and release it.
   */
  async function queueBehindBlocker(backgroundCount: number) {
    await app.app.downloads.setMaxSlots(1)
    const blocker = await setupDownloadableFile(app, { startId: 1 })
    const target = await setupDownloadableFile(app, { startId: 2 })
    const background = []
    for (let i = 0; i < backgroundCount; i++) {
      background.push(await setupDownloadableFile(app, { startId: 3 + i }))
    }
    let unblock!: () => void
    const blocked = new Promise<void>((resolve) => {
      unblock = resolve
    })
    const download = app.sdk.downloadByObjectId.bind(app.sdk)
    const fetched = jest
      .spyOn(app.sdk, 'downloadByObjectId')
      .mockImplementation(async (objectId) => {
        if (objectId === blocker.stored.id) await blocked
        return download(objectId)
      })
    const holding = app.app.downloads.downloadFile(blocker.file.id, 'user')
    await waitForCondition(
      () => app.app.downloads.getEntry(blocker.file.id)?.status === 'downloading',
    )
    return { target, background, fetched, holding, unblock }
  }

  it('a tap on a file already waiting in the background queue raises it there, so later background downloads cannot drop it', async () => {
    const { target, background, fetched, holding, unblock } = await queueBehindBlocker(20)

    const queued = app.app.downloads.downloadFile(target.file.id, 'background')
    // No state tells a download waiting in the slot pool from one still
    // reading its file row, so this gives it time to reach the pool's queue.
    await new Promise((resolve) => setTimeout(resolve, 200))
    const tapped = app.app.downloads.downloadFile(target.file.id, 'user')
    const rest = background.map(({ file }) => app.app.downloads.downloadFile(file.id, 'background'))
    expect(tapped).toBe(queued)

    unblock()
    await tapped
    await Promise.allSettled([holding, ...rest])
    expect(fetched).toHaveBeenCalledWith(target.stored.id)
    expect(await app.app.fs.readMeta(target.file.id)).toBeTruthy()
  })

  it('a tap on a file whose background download has not reached the queue yet raises it before it does', async () => {
    const { target, background, fetched, holding, unblock } = await queueBehindBlocker(20)

    const queued = app.app.downloads.downloadFile(target.file.id, 'background')
    const tapped = app.app.downloads.downloadFile(target.file.id, 'user')
    const rest = background.map(({ file }) => app.app.downloads.downloadFile(file.id, 'background'))
    expect(tapped).toBe(queued)

    unblock()
    await tapped
    await Promise.allSettled([holding, ...rest])
    expect(fetched).toHaveBeenCalledWith(target.stored.id)
    expect(await app.app.fs.readMeta(target.file.id)).toBeTruthy()
  })

  it('a background download the queue drops leaves no queued entry behind', async () => {
    const { background, holding, unblock } = await queueBehindBlocker(21)

    const all = background.map(({ file }) => app.app.downloads.downloadFile(file.id, 'background'))
    await waitForCondition(() => app.app.downloads.getEntry(background[0].file.id) === undefined)
    const queued = Object.values(app.app.downloads.getState().downloads).filter(
      (d) => d.status === 'queued',
    )
    expect(queued).toHaveLength(20)
    expect(app.app.downloads.wasDropped(background[0].file.id)).toBe(true)
    expect(app.app.downloads.wasDropped(background[1].file.id)).toBe(false)

    unblock()
    await Promise.allSettled([holding, ...all])
  })

  it('a cancelled download that finishes late leaves the new download of the same file in place', async () => {
    const { file, stored } = await setupDownloadableFile(app)
    const gates: Array<() => void> = []
    const download = app.sdk.downloadByObjectId.bind(app.sdk)
    jest.spyOn(app.sdk, 'downloadByObjectId').mockImplementation(async (objectId) => {
      if (objectId === stored.id) await new Promise<void>((resolve) => gates.push(resolve))
      return download(objectId)
    })

    const first = app.app.downloads.downloadFile(file.id, 'user')
    await waitForCondition(() => gates.length === 1)
    app.app.downloads.cancel(file.id)
    const second = app.app.downloads.downloadFile(file.id, 'user')
    await waitForCondition(() => gates.length === 2)

    gates[0]()
    await first
    expect(app.app.downloads.downloadFile(file.id, 'user')).toBe(second)

    gates[1]()
    await second
  })
})

describe('Download cancelled mid-start', () => {
  /**
   * An app whose device space and file stats the test can hold, each by its
   * next call, so a cancel lands while a download awaits one of them. Stats
   * report the slot empty, so a download never takes the already-complete
   * return.
   */
  function appWithHeldCalls(freeBytes: number) {
    const held = {
      stat: null as (() => void) | null,
      space: null as (() => void) | null,
      holdStat: false,
      holdSpace: false,
    }
    const app = createTestApp(createEmptyIndexerStorage(), {
      fsIO: {
        getDeviceSpace: async () => {
          if (held.holdSpace) {
            held.holdSpace = false
            await new Promise<void>((resolve) => {
              held.space = resolve
            })
          }
          return { freeBytes }
        },
        size: async () => {
          if (held.holdStat) {
            held.holdStat = false
            await new Promise<void>((resolve) => {
              held.stat = resolve
            })
          }
          return { value: null, error: 'not_found' as const }
        },
      },
    })
    return { app, held }
  }

  it('a cancel while a download stats its file leaves no bytes reserved', async () => {
    const fileSize = 4_000
    // Room for the file and not for a second copy of it, so a reservation
    // left behind by the cancelled download would refuse the check below.
    const { app, held } = appWithHeldCalls(DOWNLOAD_PRESERVED_DISK_BYTES + fileSize * 1.5)
    await app.start()
    app.pause()
    try {
      const { file } = await setupDownloadableFile(app, { sizeBytes: fileSize })
      expect(await app.app.downloads.checkSpaceFor([fileSize])).toBe(true)

      held.holdStat = true
      const cancelled = app.app.downloads.downloadFile(file.id, 'background')
      await waitForCondition(() => held.stat !== null)
      app.app.downloads.cancel(file.id)
      held.stat!()
      await cancelled

      expect(await app.app.downloads.checkSpaceFor([fileSize])).toBe(true)
    } finally {
      await app.shutdown()
    }
  })

  it('a cancelled download refused for space leaves the new download of the same file in place', async () => {
    // Below the reserve, so both downloads are refused for space.
    const { app, held } = appWithHeldCalls(DOWNLOAD_PRESERVED_DISK_BYTES - 1)
    await app.start()
    app.pause()
    try {
      const { file } = await setupDownloadableFile(app)

      held.holdSpace = true
      const first = app.app.downloads.downloadFile(file.id, 'user')
      await waitForCondition(() => held.space !== null)
      app.app.downloads.cancel(file.id)

      held.holdStat = true
      const second = app.app.downloads.downloadFile(file.id, 'user')
      await waitForCondition(() => held.stat !== null)

      held.space!()
      await expect(first).rejects.toThrow(INSUFFICIENT_SPACE_MESSAGE)
      expect(app.app.downloads.getEntry(file.id)?.status).toBe('queued')
      expect(app.app.downloads.downloadFile(file.id, 'user')).toBe(second)

      held.stat!()
      await expect(second).rejects.toThrow(INSUFFICIENT_SPACE_MESSAGE)
      expect(app.app.downloads.getEntry(file.id)).toBeUndefined()
    } finally {
      await app.shutdown()
    }
  })
})

describe('Transfer memory', () => {
  const MB = 1024 * 1024
  // 800 MB above Android's kill level, so a 200 MB transfer budget.
  const readMemory = () => ({
    availableBytes: 1200 * MB,
    thresholdBytes: 400 * MB,
    lowMemory: false,
  })
  let app: TestApp

  afterEach(async () => {
    await app.shutdown()
  })

  it('a download asks the SDK for read-ahead sized from what the device can spare', async () => {
    app = createTestApp(createEmptyIndexerStorage(), { readMemory })
    await app.start()
    app.pause()
    const { file } = await setupDownloadableFile(app)

    await app.app.downloads.downloadFile(file.id, 'user')

    // Half of 200 MB, at 2 MiB of memory per chunk.
    expect(app.downloadChunks).toEqual([50])
  })

  it('an upload asks the SDK to buffer one slab when the budget cannot hold two', async () => {
    app = createTestApp(createEmptyIndexerStorage(), { readMemory })
    const uploadPacked = jest.spyOn(app.sdk, 'uploadPacked')
    await app.start()
    const [file] = await app.addFiles(generateTestFiles(1, { sizeBytes: 4096 }))

    await waitForCondition(
      async () => (await app.app.localObjects.getRefsForFiles([file.id]))[file.id]?.length > 0,
    )

    expect(uploadPacked).toHaveBeenCalledWith(expect.objectContaining({ maxBufferedSlabs: 1 }))
  })

  it('a finished download gives its read-ahead back, so the next one gets the same', async () => {
    app = createTestApp(createEmptyIndexerStorage(), { readMemory })
    await app.start()
    app.pause()
    const first = await setupDownloadableFile(app, { startId: 1 })
    const second = await setupDownloadableFile(app, { startId: 2 })

    await app.app.downloads.downloadFile(first.file.id, 'user')
    await app.app.downloads.downloadFile(second.file.id, 'user')

    expect(app.downloadChunks).toEqual([50, 50])
  })

  it('a download started while an upload is open gets the download floor beside it', async () => {
    // No reading, so the fixed 904 MiB budget, of which an upload buffering
    // five slabs may take 840 MiB.
    app = createTestApp(createEmptyIndexerStorage())
    const uploadPacked = jest.spyOn(app.sdk, 'uploadPacked')
    await app.start()
    const { file } = await setupDownloadableFile(app)
    await app.addFiles(generateTestFiles(1, { startId: 2, sizeBytes: 4096 }))
    // The batch stays open until its idle timeout, well past the download.
    await waitForCondition(() => uploadPacked.mock.calls.length > 0)

    await app.app.downloads.downloadFile(file.id, 'user')

    // The upload leaves the 64 MiB download floor, and the download takes
    // half of it, 16 chunks at 2 MiB each.
    expect(app.downloadChunks).toEqual([16])
  })
})
