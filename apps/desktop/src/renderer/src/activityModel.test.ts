import { describe, expect, it } from 'bun:test'
import type { UploadEntry } from '@siastorage/core/app'
import type { RecentFile } from '@siastorage/core/types'
import {
  activityLabel,
  addedLabel,
  DEFAULT_QUICK_SHARE,
  fileActivity,
  loadQuickShare,
  rowDetail,
  saveQuickShare,
  splitName,
} from './activityModel'

function file(over: Partial<RecentFile> = {}): RecentFile {
  return {
    id: 'f1',
    name: 'beach.jpg',
    type: 'image/jpeg',
    size: 1000,
    addedAt: 0,
    folder: null,
    uploaded: false,
    local: true,
    lost: false,
    ...over,
  }
}

function upload(over: Partial<UploadEntry> = {}): UploadEntry {
  return { id: 'f1', size: 1000, progress: 0, status: 'queued', ...over }
}

describe('what the activity list says about a file', () => {
  it('calls a file with an object on the network uploaded', () => {
    expect(activityLabel(fileActivity(file({ uploaded: true }), undefined))).toBe('Uploaded')
  })

  it('gives the progress of an upload under way', () => {
    const activity = fileActivity(file(), upload({ status: 'uploading', progress: 0.427 }))
    expect(activityLabel(activity)).toBe('Uploading 42%')
  })

  it('says a file being packed is preparing to upload', () => {
    for (const status of ['packing', 'packed'] as const) {
      expect(activityLabel(fileActivity(file(), upload({ status })))).toBe('Preparing to upload')
    }
  })

  it('says a queued file, or one the uploader has not picked up yet, is waiting', () => {
    expect(activityLabel(fileActivity(file(), upload({ status: 'queued' })))).toBe(
      'Waiting to upload',
    )
    expect(activityLabel(fileActivity(file({ local: true }), undefined))).toBe('Waiting to upload')
  })

  it('reports a failed upload as an upload error', () => {
    expect(activityLabel(fileActivity(file(), upload({ status: 'error' })))).toBe('Upload error')
  })

  it('counts a file as uploaded once its object is written, whatever entry is left over', () => {
    expect(fileActivity(file({ uploaded: true }), upload({ status: 'error' })).kind).toBe(
      'uploaded',
    )
  })

  it('calls a lost file unavailable, whatever failed upload is left over', () => {
    expect(fileActivity(file({ lost: true }), upload({ status: 'error' })).kind).toBe('unavailable')
  })

  it('calls a file with no copy here and none on the network unavailable', () => {
    expect(fileActivity(file({ lost: true, local: false }), undefined).kind).toBe('unavailable')
    expect(fileActivity(file({ local: false }), undefined).kind).toBe('unavailable')
  })
})

describe('when a file was added', () => {
  const now = new Date(2026, 10, 2, 12, 0).getTime()

  it('counts minutes, then hours, then days', () => {
    expect(addedLabel(now - 20_000, now)).toBe('Just now')
    expect(addedLabel(now - 5 * 60_000, now)).toBe('5 min ago')
    expect(addedLabel(now - 3 * 3_600_000, now)).toBe('3 hr ago')
    expect(addedLabel(now - 30 * 3_600_000, now)).toBe('Yesterday')
    expect(addedLabel(now - 4 * 86_400_000, now)).toBe('4 days ago')
  })

  it('gives a date past a week, with the year only when it is another one', () => {
    expect(addedLabel(new Date(2026, 2, 4).getTime(), now)).toContain('4')
    expect(addedLabel(new Date(2026, 2, 4).getTime(), now)).not.toContain('2026')
    expect(addedLabel(new Date(2025, 2, 4).getTime(), now)).toContain('2025')
  })
})

describe('the line under a file name', () => {
  const now = new Date(2026, 10, 2, 12, 0).getTime()

  it('says only when an uploaded file was added', () => {
    const uploaded = { kind: 'uploaded' } as const
    expect(rowDetail(uploaded, now - 20_000, now)).toBe('Added just now')
    expect(rowDetail(uploaded, now - 5 * 60_000, now)).toBe('Added 5 min ago')
    expect(rowDetail(uploaded, now - 30 * 3_600_000, now)).toBe('Added yesterday')
  })

  it('gives only the state of a file that is not uploaded yet', () => {
    expect(rowDetail({ kind: 'uploading', progress: 0.5 }, now - 5 * 60_000, now)).toBe(
      'Uploading 50%',
    )
    expect(rowDetail({ kind: 'failed' }, now - 20_000, now)).toBe('Upload error')
  })
})

describe('the share button settings', () => {
  function memory(initial: string | null = null) {
    let value = initial
    return {
      getItem: () => value,
      setItem: (_key: string, next: string) => {
        value = next
      },
    }
  }

  it('makes links to this version that never expire until told otherwise', () => {
    expect(loadQuickShare(memory())).toEqual({ mode: 'snapshot', expiry: 'never' })
  })

  it('keeps the last choice', () => {
    const storage = memory()
    saveQuickShare(storage, { mode: 'latest', expiry: 'week' })
    expect(loadQuickShare(storage)).toEqual({ mode: 'latest', expiry: 'week' })
  })

  it('falls back to the default for anything it does not recognise', () => {
    expect(loadQuickShare(memory('not json'))).toEqual(DEFAULT_QUICK_SHARE)
    expect(loadQuickShare(memory('{"mode":"latest","expiry":"year"}'))).toEqual(DEFAULT_QUICK_SHARE)
    expect(loadQuickShare(memory('{"mode":"all","expiry":"day"}'))).toEqual(DEFAULT_QUICK_SHARE)
  })
})

describe('a file name split before its extension', () => {
  it('keeps the extension apart', () => {
    expect(splitName('beach-2026-holiday.jpeg')).toEqual({
      stem: 'beach-2026-holiday',
      ext: '.jpeg',
    })
  })

  it('leaves a name with no extension, a leading dot or a long last part whole', () => {
    expect(splitName('README')).toEqual({ stem: 'README', ext: '' })
    expect(splitName('.env')).toEqual({ stem: '.env', ext: '' })
    expect(splitName('notes.from-the-meeting')).toEqual({ stem: 'notes.from-the-meeting', ext: '' })
  })
})
