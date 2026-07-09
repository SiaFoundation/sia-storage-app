import type { ImportFileRow, ImportRow } from '@siastorage/core/db/operations'
import * as MediaLibrary from 'expo-media-library'
import { buildPhotoCandidateRows, resolveImportDirectoryId } from '../lib/assetImports'
import { app } from '../stores/appService'
import { clearActiveBgTask, setActiveBgTask } from './bgTaskContext'
import { triggerImportScanner } from './importScanner'
import {
  getArchiveSyncCompletedAt,
  getPhotosArchiveCursor,
  getPhotosArchiveDisplayDate,
  isArchiveWalkActive,
  restartPhotosArchiveCursor,
  resumeArchiveSync,
  run,
  setArchiveSyncCompletedAt,
  setPhotosArchiveCursor,
  startArchiveSync,
} from './syncPhotosArchive'

jest.useFakeTimers()

jest.mock('expo-media-library', () => ({
  getAssetsAsync: jest.fn(),
  SortBy: {
    creationTime: 'creationTime',
    modificationTime: 'modificationTime',
  },
  MediaType: { photo: 'photo', video: 'video' },
}))
jest.mock('../lib/mediaLibraryPermissions', () => ({
  ensureMediaLibraryPermission: jest.fn(),
  getMediaLibraryPermissions: jest.fn().mockResolvedValue(true),
  mediaLibraryPermissionsCache: {
    key: jest.fn(() => ['mediaLibraryPermissions']),
    invalidate: jest.fn(),
    set: jest.fn(),
  },
}))
jest.mock('../lib/assetImports', () => ({
  buildPhotoCandidateRows: jest.fn(),
  resolveImportDirectoryId: jest.fn().mockResolvedValue(null),
}))
jest.mock('./importScanner', () => ({
  triggerImportScanner: jest.fn(),
}))
jest.mock('../stores/files', () => ({}))
jest.mock('@siastorage/core/lib/yieldToEventLoop', () => ({
  yieldToEventLoop: jest.fn().mockResolvedValue(undefined),
}))

const getAssetsAsyncMock = jest.mocked(MediaLibrary.getAssetsAsync)
const buildRowsMock = jest.mocked(buildPhotoCandidateRows)
const resolveDirMock = jest.mocked(resolveImportDirectoryId)
const triggerScannerMock = jest.mocked(triggerImportScanner)

let inProgressSpy: jest.SpyInstance
let createSpy: jest.SpyInstance
let addFilesSpy: jest.SpyInstance
let getSpy: jest.SpyInstance
let sealSpy: jest.SpyInstance

function asset(
  id: string,
  name: string,
  opts: { creationTime?: number; modificationTime?: number },
): MediaLibrary.Asset {
  return {
    id,
    filename: name,
    uri: `file://${id}`,
    mediaType: MediaLibrary.MediaType.photo,
    creationTime: opts.creationTime ?? 0,
    modificationTime: opts.modificationTime ?? 0,
    width: 1,
    height: 1,
    duration: 0,
  }
}

function page(
  assets: MediaLibrary.Asset[],
  endCursor = '',
): MediaLibrary.PagedInfo<MediaLibrary.Asset> {
  return {
    assets,
    endCursor,
    hasNextPage: false,
    totalCount: assets.length,
  }
}

function row(id: string, mediaAssetId: string): ImportFileRow {
  return {
    id,
    importId: 'scan',
    state: 'pending',
    reason: null,
    name: `${id}.jpg`,
    type: 'image/jpeg',
    size: 0,
    hash: null,
    createdAt: 0,
    updatedAt: 0,
    addedAt: 0,
    directoryId: null,
    mediaAssetId,
    sourceKind: 'media',
    sourceUri: `file://${mediaAssetId}`,
    sourceRef: null,
    copyBytes: 0,
    attempts: 0,
    nextAttemptAt: 0,
    claimedAt: null,
    claimToken: null,
  }
}

function scanImport(over: Partial<ImportRow> = {}): ImportRow {
  return {
    id: 'scan',
    source: 'library-scan',
    directoryId: null,
    pendingTags: null,
    expectedCount: 0,
    dedupByHash: 1,
    dirSourceRef: null,
    sealed: 0,
    startedAt: 0,
    updatedAt: 0,
    ...over,
  }
}

const NOW = 1_700_000_000_000

describe('syncPhotosArchive', () => {
  beforeEach(async () => {
    jest.clearAllMocks()
    jest.setSystemTime(new Date(NOW))
    getAssetsAsyncMock.mockReset()
    resolveDirMock.mockResolvedValue(null)
    // Default: no in-progress library-scan, so a new one can start.
    inProgressSpy = jest.spyOn(app().imports, 'inProgressImport').mockResolvedValue(null)
    createSpy = jest.spyOn(app().imports, 'create').mockResolvedValue(undefined)
    addFilesSpy = jest.spyOn(app().imports, 'addFiles').mockResolvedValue(undefined)
    getSpy = jest.spyOn(app().imports, 'get').mockResolvedValue(scanImport())
    sealSpy = jest.spyOn(app().imports, 'seal').mockResolvedValue(undefined)
    buildRowsMock.mockResolvedValue([row('r1', 'a1')])
    await setArchiveSyncCompletedAt(0)
    await restartPhotosArchiveCursor()
  })

  afterEach(() => {
    inProgressSpy.mockRestore()
    createSpy.mockRestore()
    addFilesSpy.mockRestore()
    getSpy.mockRestore()
    sealSpy.mockRestore()
  })

  it('sorts by modificationTime DESC', async () => {
    await setPhotosArchiveCursor('start')
    getAssetsAsyncMock.mockResolvedValueOnce(
      page([asset('a1', '1.jpg', { modificationTime: 50_000 })], 'ref1'),
    )
    await run()
    expect(getAssetsAsyncMock).toHaveBeenCalledWith(
      expect.objectContaining({ sortBy: [['modificationTime', false]] }),
    )
  })

  it('cursor "start" fetches from beginning (no after param)', async () => {
    await setPhotosArchiveCursor('start')
    getAssetsAsyncMock.mockResolvedValueOnce(
      page([asset('a1', '1.jpg', { modificationTime: 50_000 })], 'ref1'),
    )
    await run()
    expect(getAssetsAsyncMock.mock.calls[0][0]?.after).toBeUndefined()
  })

  it('passes endCursor as after param to resume', async () => {
    await setPhotosArchiveCursor('some-asset-ref')
    getAssetsAsyncMock.mockResolvedValueOnce(
      page([asset('a1', '1.jpg', { modificationTime: 30_000 })], 'next-ref'),
    )
    await run()
    expect(getAssetsAsyncMock.mock.calls[0][0]?.after).toBe('some-asset-ref')
  })

  it('advances cursor to endCursor from page result', async () => {
    await setPhotosArchiveCursor('start')
    getAssetsAsyncMock.mockResolvedValueOnce(
      page(
        [
          asset('a1', '1.jpg', { modificationTime: 90_000 }),
          asset('a2', '2.jpg', { modificationTime: 80_000 }),
        ],
        'page-end-ref',
      ),
    )
    await run()
    expect(await getPhotosArchiveCursor()).toBe('page-end-ref')
  })

  it('returns early when the cursor is "done" (fully synced)', async () => {
    await setPhotosArchiveCursor('done')
    await run()
    expect(getAssetsAsyncMock).not.toHaveBeenCalled()
  })

  it('on empty page: marks the cursor done and records completion', async () => {
    await setPhotosArchiveCursor('some-ref')
    getAssetsAsyncMock.mockResolvedValueOnce(page([]))
    await run()
    expect(await getPhotosArchiveCursor()).toBe('done')
    expect(await getArchiveSyncCompletedAt()).toBe(NOW)
    expect(addFilesSpy).not.toHaveBeenCalled()
  })

  it('builds candidate rows (mediaAssetId dedup) and addFiles them, then kicks the scanner', async () => {
    await setPhotosArchiveCursor('start')
    getAssetsAsyncMock.mockResolvedValueOnce(
      page(
        [
          asset('a1', '1.jpg', { modificationTime: 100_000 }),
          asset('a2', '2.jpg', { modificationTime: 50_000 }),
        ],
        'ref3',
      ),
    )
    buildRowsMock.mockResolvedValueOnce([row('r1', 'a1'), row('r2', 'a2')])
    await run()
    expect(buildRowsMock).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 'a1' }), expect.objectContaining({ id: 'a2' })],
      expect.any(String),
      null,
      expect.any(Number),
    )
    expect(addFilesSpy).toHaveBeenCalledWith(expect.any(String), [
      expect.objectContaining({ mediaAssetId: 'a1' }),
      expect.objectContaining({ mediaAssetId: 'a2' }),
    ])
    expect(triggerScannerMock).toHaveBeenCalled()
  })

  it('falls back to modificationTime for timestamp when creationTime is 0', async () => {
    await setPhotosArchiveCursor('start')
    getAssetsAsyncMock.mockResolvedValueOnce(
      page([asset('a1', 'downloaded.jpg', { creationTime: 0, modificationTime: 50_000 })], 'ref1'),
    )
    await run()
    expect(buildRowsMock).toHaveBeenCalledWith(
      [expect.objectContaining({ timestamp: new Date(50_000).toISOString() })],
      expect.any(String),
      null,
      expect.any(Number),
    )
  })

  it('all-duplicates page (builder returns no rows) does not addFiles', async () => {
    await setPhotosArchiveCursor('start')
    getAssetsAsyncMock.mockResolvedValueOnce(
      page([asset('a1', '1.jpg', { modificationTime: 100_000 })], 'ref1'),
    )
    buildRowsMock.mockResolvedValueOnce([])
    await run()
    expect(addFilesSpy).not.toHaveBeenCalled()
  })

  describe('resumeArchiveSync', () => {
    it('does not start the walk during a BGAppRefreshTask', async () => {
      setActiveBgTask('com.transistorsoft.fetch', 'BGAppRefreshTask')
      try {
        await resumeArchiveSync()
        expect(isArchiveWalkActive()).toBe(false)
      } finally {
        clearActiveBgTask('com.transistorsoft.fetch')
      }
    })
  })

  describe('startArchiveSync button lock', () => {
    // inProgressImport returns walking (sealed=0) and draining (sealed=1)
    // imports alike; the manager only checks non-null, so one test covers both.
    it('is a no-op while a prior library-scan is walking or draining', async () => {
      inProgressSpy.mockResolvedValueOnce(scanImport({ sealed: 0 }))
      await startArchiveSync()
      expect(createSpy).not.toHaveBeenCalled() // no new import opened
      expect(isArchiveWalkActive()).toBe(false) // walk never started
    })
  })

  it('sets the display date to the oldest modificationTime on the page', async () => {
    await setPhotosArchiveCursor('start')
    getAssetsAsyncMock.mockResolvedValueOnce(
      page(
        [
          asset('a1', '1.jpg', { modificationTime: 100_000 }),
          asset('a2', '2.jpg', { modificationTime: 1_000 }),
        ],
        'ref2',
      ),
    )
    await run()
    expect(await getPhotosArchiveCursor()).toBe('ref2')
    expect(await getPhotosArchiveDisplayDate()).toBe(1_000)
  })
})
