import * as MediaLibrary from 'expo-media-library'
import {
  SYNC_ARCHIVE_RECENT_SCAN_INTERVAL,
  SYNC_ARCHIVE_RECENT_SCAN_LOOKBACK,
} from '../config'
import { processAssets } from '../lib/processAssets'
import {
  getLastRecentScanAt,
  getPhotosArchiveCursor,
  getPhotosArchiveDisplayDate,
  restartPhotosArchiveCursor,
  setAutoSyncPhotosArchive,
  setLastRecentScanAt,
  setPhotosArchiveCursor,
  triggerRecentScanIfNeeded,
  workBackward,
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
jest.mock('../lib/processAssets', () => ({
  processAssets: jest.fn(),
}))
jest.mock('../stores/files', () => ({
  getFileStatsLocal: jest.fn().mockResolvedValue({ count: 0, totalBytes: 0 }),
}))
jest.mock('../stores/librarySwr', () => ({
  __esModule: true,
  invalidateCacheLibraryAllStats: jest.fn(),
  invalidateCacheLibraryLists: jest.fn(),
}))

const getAssetsAsyncMock = jest.mocked(MediaLibrary.getAssetsAsync)
const processAssetsMock = jest.mocked(processAssets)

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
  processAssetsMock.mockResolvedValue({
    files: [{ id: '1' }] as never,
    updatedFiles: [],
    warnings: [],
  })
}

const NOW = 1_700_000_000_000

describe('syncPhotosArchive', () => {
  beforeEach(async () => {
    jest.clearAllMocks()
    jest.setSystemTime(new Date(NOW))
    getAssetsAsyncMock.mockReset()
    await setAutoSyncPhotosArchive(true)
    await setLastRecentScanAt(0)
    await restartPhotosArchiveCursor()
    mockProcessAssetsSuccess()
  })

  it('sorts by modificationTime DESC', async () => {
    await setPhotosArchiveCursor('start')
    getAssetsAsyncMock.mockResolvedValueOnce(
      page([asset('a1', '1.jpg', { modificationTime: 50_000 })], 'ref1'),
    )
    await workBackward()
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
    await workBackward()
    const opts = getAssetsAsyncMock.mock.calls[0][0]
    expect(opts).not.toHaveProperty('createdBefore')
    expect(opts).not.toHaveProperty('createdAfter')
  })

  it('cursor "start" fetches from beginning (no after param)', async () => {
    await setPhotosArchiveCursor('start')
    getAssetsAsyncMock.mockResolvedValueOnce(
      page([asset('a1', '1.jpg', { modificationTime: 50_000 })], 'ref1'),
    )
    await workBackward()
    expect(getAssetsAsyncMock.mock.calls[0][0]?.after).toBeUndefined()
  })

  it('passes endCursor as after param to resume', async () => {
    await setPhotosArchiveCursor('some-asset-ref')
    getAssetsAsyncMock.mockResolvedValueOnce(
      page([asset('a1', '1.jpg', { modificationTime: 30_000 })], 'next-ref'),
    )
    await workBackward()
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
    await workBackward()
    expect(await getPhotosArchiveCursor()).toBe('page-end-ref')
  })

  it('cursor "done" means fully synced — returns early', async () => {
    await setPhotosArchiveCursor('done')
    await workBackward()
    expect(getAssetsAsyncMock).not.toHaveBeenCalled()
  })

  it('sets cursor to "done" when no assets remain', async () => {
    await setPhotosArchiveCursor('some-ref')
    getAssetsAsyncMock.mockResolvedValueOnce(page([]))
    await workBackward()
    expect(await getPhotosArchiveCursor()).toBe('done')
    expect(processAssetsMock).not.toHaveBeenCalled()
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
    await workBackward()
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
    await workBackward()
    expect(processAssetsMock).toHaveBeenCalledWith([
      expect.objectContaining({
        timestamp: new Date(50_000).toISOString(),
      }),
    ])
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
    await workBackward()
    expect(processAssetsMock).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'a1' }),
      expect.objectContaining({ id: 'a2' }),
      expect.objectContaining({ id: 'a3' }),
    ])
  })

  it('aborts before processAssets when signal is aborted during getAssetsAsync', async () => {
    const getAssetsAsyncMock = jest.mocked(MediaLibrary.getAssetsAsync)
    const processAssetsMock = jest.mocked(processAssets)

    const ac = new AbortController()
    getAssetsAsyncMock.mockImplementation(async () => {
      ac.abort()
      return page([asset('b1', 'one.jpg', { modificationTime: 10_000 })])
    })

    await restartPhotosArchiveCursor()
    await workBackward(ac.signal)

    expect(processAssetsMock).not.toHaveBeenCalled()
  })

  describe('triggerRecentScanIfNeeded', () => {
    it('triggers when archive is done and interval elapsed', async () => {
      await setPhotosArchiveCursor('done')
      await setLastRecentScanAt(0)
      const triggered = await triggerRecentScanIfNeeded()
      expect(triggered).toBe(true)
      expect(await getPhotosArchiveCursor()).toBe('start')
    })

    it('skips when archive is mid-walk', async () => {
      await setPhotosArchiveCursor('some-ref')
      await setLastRecentScanAt(0)
      const triggered = await triggerRecentScanIfNeeded()
      expect(triggered).toBe(false)
      expect(await getPhotosArchiveCursor()).toBe('some-ref')
    })

    it('skips when last scan was recent', async () => {
      await setPhotosArchiveCursor('done')
      await setLastRecentScanAt(NOW - SYNC_ARCHIVE_RECENT_SCAN_INTERVAL + 1_000)
      const triggered = await triggerRecentScanIfNeeded()
      expect(triggered).toBe(false)
      expect(await getPhotosArchiveCursor()).toBe('done')
    })
  })

  describe('bounded recent scan', () => {
    it('stops at boundary during recent scan', async () => {
      await setPhotosArchiveCursor('done')
      await setLastRecentScanAt(0)
      await triggerRecentScanIfNeeded()

      const boundary = NOW - SYNC_ARCHIVE_RECENT_SCAN_LOOKBACK

      getAssetsAsyncMock.mockResolvedValueOnce(
        page(
          [
            asset('a1', '1.jpg', { modificationTime: NOW - 1_000 }),
            asset('a2', '2.jpg', { modificationTime: boundary - 1_000 }),
          ],
          'ref1',
        ),
      )
      await workBackward()

      expect(processAssetsMock).toHaveBeenCalledTimes(1)
      expect(await getPhotosArchiveCursor()).toBe('done')
      expect(await getPhotosArchiveDisplayDate()).toBe(0)
      expect(await getLastRecentScanAt()).toBe(NOW)
    })

    it('continues normally when not in recent scan mode', async () => {
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
      await workBackward()

      expect(await getPhotosArchiveCursor()).toBe('ref2')
      expect(await getPhotosArchiveDisplayDate()).toBe(1_000)
    })

    it('processes the boundary-crossing batch before stopping', async () => {
      await setPhotosArchiveCursor('done')
      await setLastRecentScanAt(0)
      await triggerRecentScanIfNeeded()

      const boundary = NOW - SYNC_ARCHIVE_RECENT_SCAN_LOOKBACK

      getAssetsAsyncMock.mockResolvedValueOnce(
        page(
          [
            asset('a1', '1.jpg', { modificationTime: boundary + 5_000 }),
            asset('a2', '2.jpg', { modificationTime: boundary - 5_000 }),
          ],
          'ref1',
        ),
      )
      await workBackward()

      expect(processAssetsMock).toHaveBeenCalledWith([
        expect.objectContaining({ id: 'a1' }),
        expect.objectContaining({ id: 'a2' }),
      ])
    })
  })
})
