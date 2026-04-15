import * as MediaLibrary from 'expo-media-library'
import { getMediaLibraryUri } from './mediaLibrary'

jest.mock('expo-media-library', () => ({
  getAssetInfoAsync: jest.fn(),
}))

const getAssetInfoAsyncMock = jest.mocked(MediaLibrary.getAssetInfoAsync)

beforeEach(() => {
  jest.clearAllMocks()
})

describe('getMediaLibraryUri', () => {
  it('returns deleted for null localId', async () => {
    expect(await getMediaLibraryUri(null)).toEqual({ status: 'deleted' })
    expect(getAssetInfoAsyncMock).not.toHaveBeenCalled()
  })

  it('returns resolved when asset is available locally', async () => {
    getAssetInfoAsyncMock.mockResolvedValue({
      localUri: 'file:///photos/IMG_001.jpg',
    } as any)

    expect(await getMediaLibraryUri('ph://asset-1')).toEqual({
      status: 'resolved',
      uri: 'file:///photos/IMG_001.jpg',
    })
    expect(getAssetInfoAsyncMock).toHaveBeenCalledWith('ph://asset-1', {
      shouldDownloadFromNetwork: true,
    })
  })

  // iOS: getAssetInfoAsync sometimes appends a hash index to localUri
  // that the file system API can't open.
  it('normalizes localUri by stripping hash suffix', async () => {
    getAssetInfoAsyncMock.mockResolvedValue({
      localUri: 'file:///photos/IMG_001.jpg#hash-index',
    } as any)

    expect(await getMediaLibraryUri('ph://asset-1')).toEqual({
      status: 'resolved',
      uri: 'file:///photos/IMG_001.jpg',
    })
  })

  // Both platforms: asset was deleted from the device photo library.
  it('returns deleted when asset is gone', async () => {
    getAssetInfoAsyncMock.mockResolvedValue(null as any)

    expect(await getMediaLibraryUri('ph://deleted')).toEqual({ status: 'deleted' })
  })

  // iOS: asset is in iCloud and the download hasn't completed or the
  // content can't be exported (e.g. slow-mo video). The asset record
  // exists but localUri is null.
  // iOS: iCloud content that hasn't finished downloading. Asset exists
  // but localUri is null because the content isn't on disk yet.
  it('returns unavailable when asset exists but localUri is null', async () => {
    getAssetInfoAsyncMock.mockResolvedValue({
      localUri: null,
      id: 'ph://icloud-video',
    } as any)

    expect(await getMediaLibraryUri('ph://icloud-video')).toEqual({ status: 'unavailable' })
  })

  // Android: cloud-only file (Google Photos "Free up space"). localUri
  // is undefined because expo-media-library only sets it when
  // ExifInterface can read the file on disk.
  it('returns unavailable when asset exists but localUri is undefined', async () => {
    getAssetInfoAsyncMock.mockResolvedValue({
      localUri: undefined,
      id: 'ph://icloud-video',
    } as any)

    expect(await getMediaLibraryUri('ph://icloud-video')).toEqual({ status: 'unavailable' })
  })

  // iOS: iCloud download or video export can throw. Android ignores the
  // shouldDownloadFromNetwork option and never does network downloads in
  // getAssetInfoAsync, so this path is iOS-only. We retry without
  // download to check if the asset still exists.
  describe('iOS: iCloud download/export failure with fallback', () => {
    it('returns unavailable when fetch throws but asset still exists', async () => {
      getAssetInfoAsyncMock
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({ id: 'ph://asset', localUri: null } as any)

      expect(await getMediaLibraryUri('ph://asset')).toEqual({ status: 'unavailable' })
      expect(getAssetInfoAsyncMock).toHaveBeenCalledTimes(2)
      expect(getAssetInfoAsyncMock).toHaveBeenNthCalledWith(2, 'ph://asset', {
        shouldDownloadFromNetwork: false,
      })
    })

    it('returns deleted when fetch throws and asset is gone', async () => {
      getAssetInfoAsyncMock
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce(null as any)

      expect(await getMediaLibraryUri('ph://gone')).toEqual({ status: 'deleted' })
    })

    it('returns deleted when both fetch and fallback throw', async () => {
      getAssetInfoAsyncMock
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Photos DB unavailable'))

      expect(await getMediaLibraryUri('ph://broken')).toEqual({ status: 'deleted' })
    })

    // iOS-specific: slow-mo and edited videos throw
    // ExportSessionFailedException during export.
    it('returns unavailable on ExportSessionFailedException', async () => {
      getAssetInfoAsyncMock
        .mockRejectedValueOnce(new Error('ExportSessionFailedException'))
        .mockResolvedValueOnce({ id: 'ph://slowmo', localUri: null } as any)

      expect(await getMediaLibraryUri('ph://slowmo')).toEqual({ status: 'unavailable' })
    })
  })
})
