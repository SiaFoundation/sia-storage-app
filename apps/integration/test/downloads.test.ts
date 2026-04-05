import { createEmptyIndexerStorage } from '@siastorage/sdk-mock'
import * as nodeFs from 'fs'
import { createTestApp, generateTestFiles, type TestApp } from './app'

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

  it('cancel removes a download entry', () => {
    app.app.downloads.register('dl-1')
    expect(app.app.downloads.getEntry('dl-1')).toBeDefined()

    app.app.downloads.cancel('dl-1')
    expect(app.app.downloads.getEntry('dl-1')).toBeUndefined()
    expect(app.app.downloads.getState().downloads).toEqual({})
  })

  it('cancelAll clears all download entries', () => {
    app.app.downloads.register('dl-1')
    app.app.downloads.register('dl-2')
    expect(Object.keys(app.app.downloads.getState().downloads)).toHaveLength(2)

    app.app.downloads.cancelAll()
    expect(app.app.downloads.getState().downloads).toEqual({})
  })

  it('setMaxSlots persists and applies', async () => {
    await app.app.downloads.setMaxSlots(5)
    expect(await app.app.settings.getMaxDownloads()).toBe(5)

    await app.app.downloads.setMaxSlots(0)
    expect(await app.app.settings.getMaxDownloads()).toBe(1)
  })

  it('acquireSlot / releaseSlot', async () => {
    const token = await app.app.downloads.acquireSlot()
    expect(typeof token).toBe('string')

    app.app.downloads.releaseSlot(token)
    app.app.downloads.releaseSlot(token)
  })

  it('register / update / remove / getEntry / getState', () => {
    app.app.downloads.register('x')
    expect(app.app.downloads.getEntry('x')).toEqual({
      id: 'x',
      status: 'queued',
      progress: 0,
    })

    app.app.downloads.update('x', { status: 'downloading', progress: 0.5 })
    expect(app.app.downloads.getEntry('x')).toEqual({
      id: 'x',
      status: 'downloading',
      progress: 0.5,
    })

    app.app.downloads.remove('x')
    expect(app.app.downloads.getEntry('x')).toBeUndefined()
    expect(app.app.downloads.getState().downloads).toEqual({})
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
