import { SYNC_NEW_PHOTOS_INTERVAL } from '../config'
import { initSyncNewPhotos } from './syncNewPhotos'
import * as MediaLibrary from 'expo-media-library'
import { ensurePhotosPermission } from '../lib/permissions'
import { processAssets } from '../lib/processAssets'

jest.useFakeTimers()

jest.mock('expo-media-library', () => ({
  getAssetsAsync: jest.fn(),
  SortBy: { creationTime: 'creationTime' },
  MediaType: { photo: 'photo', video: 'video' },
}))
jest.mock('../lib/permissions', () => ({
  ensurePhotosPermission: jest.fn(),
}))
jest.mock('../lib/processAssets', () => ({
  processAssets: jest.fn(),
}))
jest.mock('../stores/library', () => ({
  librarySwr: {
    triggerChange: jest.fn(),
    addChangeCallback: jest.fn(),
    getKey: jest.fn((k: string) => [k]),
  },
}))

async function runTick() {
  await jest.advanceTimersByTimeAsync(SYNC_NEW_PHOTOS_INTERVAL)
}

function getTime(t: number | Date | undefined): number {
  if (!t) return 0
  return typeof t === 'number' ? t : t.getTime()
}

function asset(id: string, name: string, time: number): MediaLibrary.Asset {
  return {
    id,
    filename: name,
    uri: `file://${id}`,
    mediaType: MediaLibrary.MediaType.photo,
    creationTime: time,
    modificationTime: time,
    width: 1,
    height: 1,
    duration: 0,
  }
}

function page(
  a: MediaLibrary.Asset[]
): MediaLibrary.PagedInfo<MediaLibrary.Asset> {
  return {
    assets: a,
    endCursor: '',
    hasNextPage: false,
    totalCount: a.length,
  }
}

describe('syncNewPhotos', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('iterates forward adding all new files', async () => {
    const ensurePhotosPermissionMock = jest.mocked(ensurePhotosPermission)
    const getAssetsAsyncMock = jest.mocked(MediaLibrary.getAssetsAsync)
    const processAssetsMock = jest.mocked(processAssets)

    ensurePhotosPermissionMock.mockResolvedValue(true)
    getAssetsAsyncMock
      .mockResolvedValueOnce(
        page([asset('a1', '1.jpg', 1000), asset('a2', '2.jpg', 2000)])
      )
      .mockResolvedValueOnce(page([asset('a3', '3.jpg', 2500)]))
      .mockResolvedValueOnce(page([]))
      .mockResolvedValueOnce(page([asset('a4', '4.jpg', 3000)]))

    initSyncNewPhotos()
    await runTick()
    await runTick()
    await runTick()
    await runTick()

    const opts0 = getAssetsAsyncMock.mock.calls[0][0]
    const opts1 = getAssetsAsyncMock.mock.calls[1][0]
    const opts2 = getAssetsAsyncMock.mock.calls[2][0]
    const opts3 = getAssetsAsyncMock.mock.calls[3][0]
    // createdAfter is set to current time on first init.
    expect(getTime(opts0?.createdAfter)).toBeGreaterThan(0)
    // First tick had two assets, two process calls.
    expect(getTime(opts1?.createdAfter)).toBe(2000)
    // Third tick had no assets, no further processing.
    expect(getTime(opts2?.createdAfter)).toBe(2500)
    // Fourth tick had one asset, one process call.
    expect(getTime(opts3?.createdAfter)).toBe(2500)
    expect(processAssetsMock).toHaveBeenCalledTimes(3)
    expect(processAssetsMock).toHaveBeenNthCalledWith(1, [
      expect.objectContaining({ id: 'a1', name: '1.jpg' }),
      expect.objectContaining({ id: 'a2', name: '2.jpg' }),
    ])
    expect(processAssetsMock).toHaveBeenNthCalledWith(2, [
      expect.objectContaining({ id: 'a3', name: '3.jpg' }),
    ])
    expect(processAssetsMock).toHaveBeenNthCalledWith(3, [
      expect.objectContaining({ id: 'a4', name: '4.jpg' }),
    ])
  })
})
