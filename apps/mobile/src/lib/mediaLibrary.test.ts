import * as MediaLibrary from 'expo-media-library'
import { getMediaLibraryDisplayUri, getMediaLibraryUri } from './mediaLibrary'

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

  // iOS: iCloud content that hasn't finished downloading. The asset exists
  // but localUri is null and asset.uri is ph://, so there are no readable
  // bytes; the file:// fallback must not fire and the row stays retryable.
  it('returns unavailable when localUri is null and asset.uri is ph://', async () => {
    getAssetInfoAsyncMock.mockResolvedValue({
      localUri: null,
      uri: 'ph://icloud-video/L0/001',
      id: 'ph://icloud-video',
    } as any)

    expect(await getMediaLibraryUri('ph://icloud-video')).toEqual({ status: 'unavailable' })
  })

  it('returns unavailable when asset has neither localUri nor uri', async () => {
    getAssetInfoAsyncMock.mockResolvedValue({
      localUri: undefined,
      id: 'ph://no-uris',
    } as any)

    expect(await getMediaLibraryUri('ph://no-uris')).toEqual({ status: 'unavailable' })
  })

  // Android: videos never get localUri (expo's ExifInterface branch is
  // image-only) but asset.uri carries the readable file://$DATA path.
  it('resolves an Android video via the file:// asset.uri fallback', async () => {
    getAssetInfoAsyncMock.mockResolvedValue({
      localUri: undefined,
      uri: 'file:///storage/emulated/0/DCIM/Camera/PXL_001.mp4',
    } as any)

    expect(await getMediaLibraryUri('42')).toEqual({
      status: 'resolved',
      uri: 'file:///storage/emulated/0/DCIM/Camera/PXL_001.mp4',
    })
  })

  it('returns unavailable when asset.uri is a content:// provider uri', async () => {
    getAssetInfoAsyncMock.mockResolvedValue({
      localUri: null,
      uri: 'content://media/external/video/media/42',
    } as any)

    expect(await getMediaLibraryUri('42')).toEqual({ status: 'unavailable' })
  })

  it('returns unavailable when localUri is a non-file scheme', async () => {
    getAssetInfoAsyncMock.mockResolvedValue({
      localUri: 'ph://not-a-local-file',
      uri: null,
    } as any)

    expect(await getMediaLibraryUri('42')).toEqual({ status: 'unavailable' })
  })

  it('normalizes the fallback asset.uri by stripping hash suffix', async () => {
    getAssetInfoAsyncMock.mockResolvedValue({
      localUri: null,
      uri: 'file:///storage/emulated/0/DCIM/Camera/PXL_002.mp4#idx',
    } as any)

    expect(await getMediaLibraryUri('43')).toEqual({
      status: 'resolved',
      uri: 'file:///storage/emulated/0/DCIM/Camera/PXL_002.mp4',
    })
  })

  it('prefers localUri over asset.uri when both are present', async () => {
    getAssetInfoAsyncMock.mockResolvedValue({
      localUri: 'file:///photos/local.jpg',
      uri: 'file:///storage/other.jpg',
    } as any)

    expect(await getMediaLibraryUri('44')).toEqual({
      status: 'resolved',
      uri: 'file:///photos/local.jpg',
    })
  })

  // iOS: iCloud download or video export can throw. Android ignores the
  // shouldDownloadFromNetwork option and never does network downloads in
  // getAssetInfoAsync, so this path is iOS-only. We retry without
  // download to check if the asset still exists.
  describe('iOS: iCloud download/export failure with existence recheck', () => {
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

    // A transient Photos-DB error on both fetches must stay retryable;
    // only a clean null return means the asset is actually deleted.
    it('returns unavailable when both the fetch and the existence recheck throw', async () => {
      getAssetInfoAsyncMock
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Photos DB unavailable'))

      expect(await getMediaLibraryUri('ph://broken')).toEqual({ status: 'unavailable' })
    })

    // The retry exists only to distinguish existence; the file:// fallback
    // is happy-path-only and must not fire here.
    it('never applies the uri fallback in the retry branch', async () => {
      getAssetInfoAsyncMock
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          localUri: null,
          uri: 'file:///storage/emulated/0/DCIM/Camera/PXL_003.jpg',
        } as any)

      expect(await getMediaLibraryUri('45')).toEqual({ status: 'unavailable' })
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

describe('getMediaLibraryDisplayUri', () => {
  it('returns deleted for null localId', async () => {
    expect(await getMediaLibraryDisplayUri(null)).toEqual({ status: 'deleted' })
    expect(getAssetInfoAsyncMock).not.toHaveBeenCalled()
  })

  // Eager step: triggers iCloud download so iOS image previews work in
  // FileViewer for assets not yet on disk.
  it('requests with shouldDownloadFromNetwork=true and returns localUri', async () => {
    getAssetInfoAsyncMock.mockResolvedValue({
      localUri: 'file:///photos/IMG_001.jpg',
    } as any)

    expect(await getMediaLibraryDisplayUri('ph://icloud-photo')).toEqual({
      status: 'resolved',
      uri: 'file:///photos/IMG_001.jpg',
    })
    expect(getAssetInfoAsyncMock).toHaveBeenCalledWith('ph://icloud-photo', {
      shouldDownloadFromNetwork: true,
    })
  })

  it('normalizes localUri by stripping hash suffix', async () => {
    getAssetInfoAsyncMock.mockResolvedValue({
      localUri: 'file:///photos/IMG_001.jpg#hash-index',
      uri: 'ph://asset-1',
    } as any)

    expect(await getMediaLibraryDisplayUri('ph://asset-1')).toEqual({
      status: 'resolved',
      uri: 'file:///photos/IMG_001.jpg',
    })
  })

  // Eager fetch succeeded but no localUri (download didn't materialize a
  // file). Fall through to asset.uri — ph:// on iOS for video, file://
  // on Android.
  it('falls back to asset.uri when eager fetch returns null localUri', async () => {
    getAssetInfoAsyncMock.mockResolvedValue({
      localUri: null,
      uri: 'ph://asset-2/L0/001',
    } as any)

    expect(await getMediaLibraryDisplayUri('ph://asset-2')).toEqual({
      status: 'resolved',
      uri: 'ph://asset-2/L0/001',
    })
    expect(getAssetInfoAsyncMock).toHaveBeenCalledTimes(1)
  })

  it('returns deleted when eager fetch returns null asset', async () => {
    getAssetInfoAsyncMock.mockResolvedValue(null as any)

    expect(await getMediaLibraryDisplayUri('ph://deleted')).toEqual({ status: 'deleted' })
  })

  // iOS: AVAssetExportSession throws on slow-mo / HEVC / edited iCloud
  // videos. The retry without download grabs asset.uri (ph://) so AVPlayer
  // can still play it via PHImageManager — this is the regression PR #665
  // originally fixed and the reason we keep the fallback step.
  it('retries without download and returns asset.uri when eager throws', async () => {
    getAssetInfoAsyncMock
      .mockRejectedValueOnce(new Error('ExportSessionFailedException'))
      .mockResolvedValueOnce({
        localUri: null,
        uri: 'ph://slowmo/L0/001',
      } as any)

    expect(await getMediaLibraryDisplayUri('ph://slowmo')).toEqual({
      status: 'resolved',
      uri: 'ph://slowmo/L0/001',
    })
    expect(getAssetInfoAsyncMock).toHaveBeenCalledTimes(2)
    expect(getAssetInfoAsyncMock).toHaveBeenNthCalledWith(2, 'ph://slowmo', {
      shouldDownloadFromNetwork: false,
    })
  })

  it('returns deleted when eager throws and retry returns null', async () => {
    getAssetInfoAsyncMock
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce(null as any)

    expect(await getMediaLibraryDisplayUri('ph://gone')).toEqual({ status: 'deleted' })
  })

  it('returns deleted when both eager and retry throw', async () => {
    getAssetInfoAsyncMock
      .mockRejectedValueOnce(new Error('Network error'))
      .mockRejectedValueOnce(new Error('Photos DB unavailable'))

    expect(await getMediaLibraryDisplayUri('ph://broken')).toEqual({ status: 'deleted' })
  })

  it('returns unavailable when the fetch resolves with neither localUri nor asset.uri', async () => {
    getAssetInfoAsyncMock.mockResolvedValue({ localUri: null, uri: null } as any)

    expect(await getMediaLibraryDisplayUri('ph://no-uri')).toEqual({ status: 'unavailable' })
  })
})
