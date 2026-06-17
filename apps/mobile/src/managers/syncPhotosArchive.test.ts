import * as MediaLibrary from 'expo-media-library'
import { catalogAssets } from '../lib/assetImports'
import { clearActiveBgTask, setActiveBgTask } from './bgTaskContext'
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
  catalogAssets: jest.fn(),
}))
jest.mock('../stores/files', () => ({}))
jest.mock('@siastorage/core/lib/yieldToEventLoop', () => ({
  yieldToEventLoop: jest.fn().mockResolvedValue(undefined),
}))

const getAssetsAsyncMock = jest.mocked(MediaLibrary.getAssetsAsync)
const catalogAssetsMock = jest.mocked(catalogAssets)

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

function mockProcessAssetsSuccess() {
  catalogAssetsMock.mockResolvedValue({
    newCount: 1,
    existingCount: 0,
  })
}

const NOW = 1_700_000_000_000

describe('syncPhotosArchive', () => {
  beforeEach(async () => {
    jest.clearAllMocks()
    jest.setSystemTime(new Date(NOW))
    getAssetsAsyncMock.mockReset()
    await setArchiveSyncCompletedAt(0)
    await restartPhotosArchiveCursor()
    mockProcessAssetsSuccess()
  })

  it('sorts by modificationTime DESC', async () => {
    await setPhotosArchiveCursor('start')
    getAssetsAsyncMock.mockResolvedValueOnce(
      page([asset('a1', '1.jpg', { modificationTime: 50_000 })], 'ref1'),
    )
    await run()
    expect(getAssetsAsyncMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sortBy: [['modificationTime', false]],
      }),
    )
  })

  it('does not pass createdBefore or createdAfter', async () => {
    await setPhotosArchiveCursor('start')
    getAssetsAsyncMock.mockResolvedValueOnce(
      page([asset('a1', '1.jpg', { modificationTime: 50_000 })], 'ref1'),
    )
    await run()
    const opts = getAssetsAsyncMock.mock.calls[0][0]
    expect(opts).not.toHaveProperty('createdBefore')
    expect(opts).not.toHaveProperty('createdAfter')
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

  it('cursor "done" means fully synced — returns early', async () => {
    await setPhotosArchiveCursor('done')
    await run()
    expect(getAssetsAsyncMock).not.toHaveBeenCalled()
  })

  it('sets cursor to "done" and records completion time when no assets remain', async () => {
    await setPhotosArchiveCursor('some-ref')
    getAssetsAsyncMock.mockResolvedValueOnce(page([]))
    await run()
    expect(await getPhotosArchiveCursor()).toBe('done')
    expect(await getArchiveSyncCompletedAt()).toBe(NOW)
    expect(catalogAssetsMock).not.toHaveBeenCalled()
  })

  it('stores displayDate from oldest modificationTime in batch', async () => {
    await setPhotosArchiveCursor('start')
    getAssetsAsyncMock.mockResolvedValueOnce(
      page(
        [
          asset('a1', '1.jpg', { modificationTime: 90_000 }),
          asset('a2', '2.jpg', { modificationTime: 40_000 }),
          asset('a3', '3.jpg', { modificationTime: 70_000 }),
        ],
        'ref3',
      ),
    )
    await run()
    expect(await getPhotosArchiveDisplayDate()).toBe(40_000)
  })

  it('restartPhotosArchiveCursor sets cursor to "start" and clears displayDate', async () => {
    await setPhotosArchiveCursor('some-ref')
    await restartPhotosArchiveCursor()
    expect(await getPhotosArchiveCursor()).toBe('start')
    expect(await getPhotosArchiveDisplayDate()).toBe(0)
  })

  it('falls back to modificationTime for timestamp when creationTime is 0', async () => {
    await setPhotosArchiveCursor('start')
    getAssetsAsyncMock.mockResolvedValueOnce(
      page(
        [
          asset('a1', 'downloaded.jpg', {
            creationTime: 0,
            modificationTime: 50_000,
          }),
        ],
        'ref1',
      ),
    )
    await run()
    expect(catalogAssetsMock).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          timestamp: new Date(50_000).toISOString(),
        }),
      ],
      'file',
      { addToImportDirectory: true },
      undefined,
    )
  })

  it('processes all assets on the page without filtering', async () => {
    await setPhotosArchiveCursor('start')
    getAssetsAsyncMock.mockResolvedValueOnce(
      page(
        [
          asset('a1', '1.jpg', { modificationTime: 100_000 }),
          asset('a2', '2.jpg', { modificationTime: 1_000 }),
          asset('a3', '3.jpg', { modificationTime: 50_000 }),
        ],
        'ref3',
      ),
    )
    await run()
    expect(catalogAssetsMock).toHaveBeenCalledWith(
      [
        expect.objectContaining({ id: 'a1' }),
        expect.objectContaining({ id: 'a2' }),
        expect.objectContaining({ id: 'a3' }),
      ],
      'file',
      { addToImportDirectory: true },
      undefined,
    )
  })

  describe('resumeArchiveSync', () => {
    it('does not start the walk during a BGAppRefreshTask', async () => {
      // Cursor is non-DONE (set by restartPhotosArchiveCursor in beforeEach),
      // so without the gate resume would kick off runArchiveWalk and set
      // activeWalk. With the gate, the function returns before that.
      setActiveBgTask('com.transistorsoft.fetch', 'BGAppRefreshTask')
      try {
        await resumeArchiveSync()
        expect(isArchiveWalkActive()).toBe(false)
      } finally {
        clearActiveBgTask('com.transistorsoft.fetch')
      }
    })
  })

  describe('walk', () => {
    it('advances the cursor and display date through a page', async () => {
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
})
