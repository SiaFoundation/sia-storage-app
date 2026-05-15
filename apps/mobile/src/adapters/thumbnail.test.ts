import { getOsThumbnail } from 'sia-os-thumb'
import { createMobileThumbnailAdapter } from './thumbnail'

const getOsThumbnailMock = jest.mocked(getOsThumbnail)

beforeEach(() => {
  getOsThumbnailMock.mockReset()
})

describe('createMobileThumbnailAdapter generateImageThumbnails', () => {
  it('returns OS-cached tiles for every size and skips the resize cascade', async () => {
    getOsThumbnailMock.mockImplementation(async (_localId: string, size: number) => ({
      uri: `file:///cache/${size}.jpg`,
      width: size,
      height: size,
      mimeType: 'image/jpeg',
    }))

    const adapter = createMobileThumbnailAdapter()
    const results = await adapter.generateImageThumbnails('file:///orig.jpg', [64, 512], {
      localId: 'ph://abc',
    })

    expect(results.get(64)).toEqual({ savedUri: 'file:///cache/64.jpg', mimeType: 'image/jpeg' })
    expect(results.get(512)).toEqual({ savedUri: 'file:///cache/512.jpg', mimeType: 'image/jpeg' })
    expect(getOsThumbnailMock).toHaveBeenCalledTimes(2)
  })

  it('skips the OS path entirely when localId is missing', async () => {
    const adapter = createMobileThumbnailAdapter()
    // sourcePath doesn't exist; the cascade will throw, which is fine —
    // we only need to assert the OS path was never queried.
    await expect(
      adapter.generateImageThumbnails('file:///does-not-exist.jpg', [64, 512], { localId: null }),
    ).rejects.toThrow()
    expect(getOsThumbnailMock).not.toHaveBeenCalled()
  })
})
