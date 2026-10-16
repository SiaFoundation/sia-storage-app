import type { DownloadLikeRef } from '@siastorage/core/adapters'
import type { downloadToCache as DownloadToCache } from './downloadToCache'

type TempInfo = { id: string; attempt?: string }
const mockCreateTemp = jest.fn(async (info: TempInfo) => ({
  uri: `file:///cache/files/${info.id}.${info.attempt}.download.tmp`,
}))
const mockRemoveTemp = jest.fn(async (_info: TempInfo) => {})
jest.mock('../stores/tempFs', () => ({
  getOrCreateTempDownloadFile: (info: TempInfo) => mockCreateTemp(info),
  removeTempDownloadFile: (info: TempInfo) => mockRemoveTemp(info),
}))
// Required in a registry of its own. Imported or required at the top level,
// it gets the real tempFs despite the mock above.
let downloadToCache!: typeof DownloadToCache
jest.isolateModules(() => {
  downloadToCache = require('./downloadToCache').downloadToCache
})

const FILE = { id: 'vid1', type: 'video/quicktime' }

/** A download whose `writeToPath` reports `written` bytes, or waits for an abort. */
function downloadWriting(written: number | 'until-aborted'): DownloadLikeRef & {
  cancel: jest.Mock
} {
  return {
    read: async () => new ArrayBuffer(0),
    writeToPath: (_path, control) =>
      written === 'until-aborted'
        ? new Promise((_, reject) => {
            if (control?.signal.aborted) reject(new Error('cancelled'))
            control?.signal.addEventListener('abort', () => reject(new Error('cancelled')))
          })
        : Promise.resolve(BigInt(written)),
    cancel: jest.fn(async () => {}),
  }
}

function run(dl: DownloadLikeRef, signal = new AbortController().signal) {
  const onComplete = jest.fn(async () => {})
  const promise = downloadToCache({
    file: FILE,
    totalSize: 1024,
    dl,
    signal,
    onProgress: () => {},
    onComplete,
  })
  return { promise, onComplete }
}

beforeEach(() => {
  mockRemoveTemp.mockClear()
  mockCreateTemp.mockClear()
})

describe('downloadToCache', () => {
  it('hands a complete file to onComplete and cancels the SDK download', async () => {
    const dl = downloadWriting(1024)
    const { promise, onComplete } = run(dl)
    await promise
    expect(onComplete).toHaveBeenCalledWith(
      expect.stringMatching(/^file:\/\/\/cache\/files\/vid1\..+\.download\.tmp$/),
    )
    expect(dl.cancel).toHaveBeenCalled()
  })

  it('a download that ends short fails and leaves nothing in storage', async () => {
    const { promise, onComplete } = run(downloadWriting(256))
    await expect(promise).rejects.toThrow('Download ended at 256 of 1024 bytes')
    expect(onComplete).not.toHaveBeenCalled()
    expect(mockRemoveTemp).toHaveBeenCalled()
  })

  it('a cancelled download rejects as aborted and removes its partial file', async () => {
    const controller = new AbortController()
    const dl = downloadWriting('until-aborted')
    const { promise, onComplete } = run(dl, controller.signal)
    controller.abort()
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    expect(onComplete).not.toHaveBeenCalled()
    expect(mockRemoveTemp).toHaveBeenCalled()
    expect(dl.cancel).toHaveBeenCalled()
  })

  it('a cancelled attempt cleans up its own temp file, not the one a retry started meanwhile', async () => {
    const cancelled = new AbortController()
    const first = run(downloadWriting('until-aborted'), cancelled.signal)
    const retry = run(downloadWriting(1024))
    cancelled.abort()
    await expect(first.promise).rejects.toThrow()
    await retry.promise

    const [firstInfo, retryInfo] = mockCreateTemp.mock.calls.map(([info]) => info)
    expect(firstInfo.attempt).not.toBe(retryInfo.attempt)
    expect(mockRemoveTemp).toHaveBeenCalledTimes(1)
    expect(mockRemoveTemp.mock.calls[0][0].attempt).toBe(firstInfo.attempt)
  })
})
