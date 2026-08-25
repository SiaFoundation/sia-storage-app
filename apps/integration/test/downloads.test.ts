import { DOWNLOAD_PRESERVED_DISK_BYTES, INSUFFICIENT_SPACE_MESSAGE } from '@siastorage/core/config'
import { createEmptyIndexerStorage } from '@siastorage/sdk-mock'
import * as nodeFs from 'fs'
import { createTestApp, generateTestFiles, type TestApp } from './app'

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
      await expect(probing.app.downloads.downloadFile(file.id)).rejects.toThrow(
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

    await app.app.downloads.downloadFile(file.id)

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

    await app.app.downloads.downloadFile(file.id)

    const entry = app.app.downloads.getEntry(file.id)
    expect(entry).toBeUndefined()

    const meta = await app.app.fs.readMeta(file.id)
    expect(meta).not.toBeNull()
    expect(meta!.size).toBe(file.size)
  })

  it('deduplicates concurrent downloads for the same file', async () => {
    const { file } = await setupDownloadableFile(app)

    const [r1, r2] = await Promise.all([
      app.app.downloads.downloadFile(file.id),
      app.app.downloads.downloadFile(file.id),
    ])

    expect(r1).toBeUndefined()
    expect(r2).toBeUndefined()

    const entry = app.app.downloads.getEntry(file.id)
    expect(entry?.status).toBe('done')
  })

  it('throws if file record not found', async () => {
    await expect(app.app.downloads.downloadFile('nonexistent-id')).rejects.toThrow(
      'File record not found',
    )
  })

  it('throws if no local objects available', async () => {
    const [file] = await app.addFiles(generateTestFiles(1, { startId: 1 }))
    await app.removeFsFile(file.id, file.type)

    await expect(app.app.downloads.downloadFile(file.id)).rejects.toThrow(
      'No object available for download',
    )
  })

  it('throws if SDK not initialized', async () => {
    const { file } = await setupDownloadableFile(app)
    app.internal.setSdk(null)

    await expect(app.app.downloads.downloadFile(file.id)).rejects.toThrow('SDK not initialized')
  })

  it('setMaxSlots persists and applies', async () => {
    await app.app.downloads.setMaxSlots(5)
    expect(await app.app.settings.getMaxDownloads()).toBe(5)

    await app.app.downloads.setMaxSlots(0)
    expect(await app.app.settings.getMaxDownloads()).toBe(1)
  })

  it('progress reports file.size-based progress', async () => {
    const { file } = await setupDownloadableFile(app, { sizeBytes: 1024 })

    await app.app.downloads.downloadFile(file.id)

    const entry = app.app.downloads.getEntry(file.id)
    expect(entry?.progress).toBe(1)

    const meta = await app.app.fs.readMeta(file.id)
    expect(meta!.size).toBe(file.size)
  })
})
