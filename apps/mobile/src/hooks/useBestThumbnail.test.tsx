import { renderHook } from '@testing-library/react-native'
import { useThumbnailUri } from './useBestThumbnail'

const mockThumb = { id: 'thumb-1', kind: 'thumb' }
const mockDownload = jest.fn()
const mockWasDropped = jest.fn()

jest.mock('@siastorage/core/stores', () => ({
  useIsInitializing: () => false,
}))
jest.mock('../stores/sdk', () => ({
  useIsConnected: () => true,
}))
jest.mock('../stores/fs', () => ({
  useFsFileUri: () => ({ data: null }),
}))
jest.mock('../lib/mediaLibrary', () => ({
  getOsThumbnailUri: jest.fn(),
}))
jest.mock('../stores/appService', () => ({
  app: () => ({
    caches: { thumbnails: { best: { key: (...parts: string[]) => ['best', ...parts] } } },
    thumbnails: { getBest: jest.fn() },
    downloads: { wasDropped: mockWasDropped },
  }),
}))
jest.mock('swr', () => ({
  __esModule: true,
  default: (key: unknown) => ({ data: key ? mockThumb : undefined, mutate: jest.fn() }),
}))
// A thumbnail on the network with no local copy, whose download reads as idle:
// never started, dropped from the background queue, or cancelled.
jest.mock('../lib/file', () => ({
  useFileStatus: () => ({ data: { canAutoFetch: true, download: { state: 'idle' } } }),
}))
jest.mock('../managers/downloader', () => ({
  useDownload: () => mockDownload,
}))

const file = { id: 'file-1', hash: 'sha256:abc', mediaAssetId: null } as never

describe('useThumbnailUri', () => {
  beforeEach(() => {
    mockDownload.mockClear()
    mockWasDropped.mockReset()
  })

  it('asks for a thumbnail once while its tile stays mounted after the background queue drops it', () => {
    mockWasDropped.mockReturnValue(true)
    const { rerender } = renderHook(() => useThumbnailUri(file))
    rerender(undefined)
    rerender(undefined)
    expect(mockDownload).toHaveBeenCalledTimes(1)
  })

  it('asks again after a drop when the tile mounts again, as a tile scrolled back into view does', () => {
    mockWasDropped.mockReturnValue(true)
    renderHook(() => useThumbnailUri(file)).unmount()
    renderHook(() => useThumbnailUri(file))
    expect(mockDownload).toHaveBeenCalledTimes(2)
  })

  it('asks again while its tile stays mounted when its download was cancelled, as a suspension cancels every download', () => {
    mockWasDropped.mockReturnValue(false)
    const { rerender } = renderHook(() => useThumbnailUri(file))
    rerender(undefined)
    expect(mockDownload).toHaveBeenCalledTimes(2)
    expect(mockWasDropped).toHaveBeenCalledWith('thumb-1')
  })
})
