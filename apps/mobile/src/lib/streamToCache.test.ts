import type { DownloadLikeRef } from '@siastorage/core/adapters'
import { streamToCache } from './streamToCache'

/*
 * A download that stops early must fail rather than hand the caller what it
 * got. The SDK ends a stream with a read of nothing and answers a cancelled
 * download the same way, so the loop cannot tell a truncated transfer from a
 * finished one without comparing what it wrote against the expected size.
 */

const FILE = { id: 'vid1', type: 'video/quicktime' }

/** Hands out `chunks` in order, then reads of nothing forever. */
function downloadOf(chunks: Uint8Array[]): DownloadLikeRef {
  let i = 0
  return {
    read: async () =>
      i < chunks.length ? (chunks[i++].buffer as ArrayBuffer) : new ArrayBuffer(0),
    cancel: async () => {},
  }
}

describe('a download that ends early', () => {
  it('fails instead of reporting a short file as complete', async () => {
    await expect(
      streamToCache({ file: FILE, totalSize: 1024, dl: downloadOf([new Uint8Array(256)]) }),
    ).rejects.toThrow('Download ended at 256 of 1024 bytes')
  })

  it('does not run onAfterClose, which is what would publish the partial', async () => {
    const onAfterClose = jest.fn(async () => {})

    await expect(
      streamToCache({
        file: FILE,
        totalSize: 1024,
        dl: downloadOf([new Uint8Array(256)]),
        onAfterClose,
      }),
    ).rejects.toThrow()

    expect(onAfterClose).not.toHaveBeenCalled()
  })

  it('fails when the stream stops between chunks, not only on the first', async () => {
    await expect(
      streamToCache({
        file: FILE,
        totalSize: 1024,
        dl: downloadOf([new Uint8Array(512), new Uint8Array(256)]),
      }),
    ).rejects.toThrow('Download ended at 768 of 1024 bytes')
  })
})

describe('a download the caller aborted', () => {
  it('does not report the bytes it never asked for as a short file', async () => {
    const controller = new AbortController()
    controller.abort()

    await streamToCache({
      file: FILE,
      totalSize: 1024,
      dl: downloadOf([new Uint8Array(256)]),
      signal: controller.signal,
    })
  })
})

describe('a download that delivers every byte', () => {
  it('hands the file to onAfterClose', async () => {
    const onAfterClose = jest.fn(async () => {})

    await streamToCache({
      file: FILE,
      totalSize: 512,
      dl: downloadOf([new Uint8Array(512)]),
      onAfterClose,
    })

    expect(onAfterClose).toHaveBeenCalled()
  })
})
