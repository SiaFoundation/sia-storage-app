import type { UploadEntry } from '../app/stores'
import { filesWaitingToUpload, NO_UPLOADS, summarizeUploads } from './uploadActivity'

const entry = (over: Partial<UploadEntry>): UploadEntry => ({
  id: 'f',
  kind: 'file',
  size: 100,
  progress: 0,
  status: 'uploading',
  ...over,
})

describe('the uploads the daemon holds, summed', () => {
  it('counts files and thumbnails in flight but only files by name', () => {
    const summary = summarizeUploads([
      entry({ id: 'a', size: 300, progress: 1 }),
      entry({ id: 'b', size: 100, progress: 0, status: 'packing' }),
      entry({ id: 't', kind: 'thumb', size: 100, progress: 0, status: 'packed' }),
    ])

    expect(summary.active).toBe(3)
    expect(summary.activeFiles).toBe(2)
    expect(summary.activeFileBytes).toBe(400)
    expect(summary.progress).toBe(0.6)
  })

  it('keeps queued entries apart from the ones in flight', () => {
    const summary = summarizeUploads([
      entry({ id: 'a', status: 'queued' }),
      entry({ id: 't', kind: 'thumb', status: 'queued' }),
    ])

    expect(summary).toEqual({ ...NO_UPLOADS, queued: 2, queuedFiles: 1 })
  })

  it('leaves out uploads that finished', () => {
    expect(summarizeUploads([entry({ id: 'a', status: 'done', progress: 1 })])).toEqual(NO_UPLOADS)
  })

  it('counts failed files apart from the ones in flight, and leaves out failed thumbnails', () => {
    const summary = summarizeUploads([
      entry({ id: 'a', status: 'error' }),
      entry({ id: 't', kind: 'thumb', status: 'error' }),
    ])

    expect(summary).toEqual({ ...NO_UPLOADS, failedFiles: 1 })
  })
})

describe('files waiting to upload', () => {
  it('counts files the library has with no copy on the network that the uploader has not taken', () => {
    expect(filesWaitingToUpload(NO_UPLOADS, 3)).toBe(3)
  })

  it('leaves out the files being sent, which the library count includes', () => {
    expect(filesWaitingToUpload({ ...NO_UPLOADS, active: 2, activeFiles: 2 }, 5)).toBe(3)
  })

  it('counts queued files the library count has not caught up with yet', () => {
    expect(filesWaitingToUpload({ ...NO_UPLOADS, queued: 4, queuedFiles: 4 }, 1)).toBe(4)
  })

  it('never goes below zero when the library count is behind the files in flight', () => {
    expect(filesWaitingToUpload({ ...NO_UPLOADS, active: 3, activeFiles: 3 }, 1)).toBe(0)
  })
})
