import type { FileRecord } from '@siastorage/core/types'
import { computeFileStatus, fileRecordEqual } from './file'

function makeFileRecord(overrides?: Partial<FileRecord>): FileRecord {
  return {
    id: 'file-1',
    name: 'photo.jpg',
    type: 'image/jpeg',
    kind: 'file',
    size: 1000,
    hash: 'sha256:abc123',
    createdAt: 1000,
    updatedAt: 2000,
    localId: null,
    addedAt: 1000,
    trashedAt: null,
    deletedAt: null,
    objects: {},
    ...overrides,
  }
}

describe('fileRecordEqual', () => {
  it('returns true when updatedAt, hash, and objects match', () => {
    const a = makeFileRecord()
    const b = makeFileRecord()
    expect(fileRecordEqual(a, b)).toBe(true)
  })

  it('returns true when both have same number of objects', () => {
    const objects = {
      'https://indexer.example.com': {} as any,
    }
    const a = makeFileRecord({ objects })
    const b = makeFileRecord({ objects })
    expect(fileRecordEqual(a, b)).toBe(true)
  })

  it('returns false when updatedAt differs', () => {
    const a = makeFileRecord({ updatedAt: 2000 })
    const b = makeFileRecord({ updatedAt: 3000 })
    expect(fileRecordEqual(a, b)).toBe(false)
  })

  it('returns false when hash differs (processing to finalized transition)', () => {
    const a = makeFileRecord({ hash: '' })
    const b = makeFileRecord({ hash: 'sha256:abc123' })
    expect(fileRecordEqual(a, b)).toBe(false)
  })

  it('returns false when objects count differs', () => {
    const a = makeFileRecord({ objects: {} })
    const b = makeFileRecord({
      objects: { 'https://indexer.example.com': {} as any },
    })
    expect(fileRecordEqual(a, b)).toBe(false)
  })

  it('returns true when non-compared fields differ', () => {
    const a = makeFileRecord({ name: 'old.jpg', size: 100 })
    const b = makeFileRecord({ name: 'new.jpg', size: 200 })
    expect(fileRecordEqual(a, b)).toBe(true)
  })
})

describe('computeFileStatus', () => {
  const baseArgs = {
    uploadState: undefined,
    downloadState: undefined,
    fileUri: null,
    errorText: null,
  }

  describe('isImportFailed', () => {
    it('is false when file has no lostReason', () => {
      const file = makeFileRecord({ hash: '', lostReason: null })
      const status = computeFileStatus({ ...baseArgs, file })
      expect(status.isImportFailed).toBe(false)
    })

    it('is true when file has a lostReason', () => {
      const file = makeFileRecord({
        hash: '',
        lostReason: 'Source photo deleted from device',
      })
      const status = computeFileStatus({ ...baseArgs, file })
      expect(status.isImportFailed).toBe(true)
    })

    it('is true even if file has a hash and lostReason', () => {
      const file = makeFileRecord({
        hash: 'sha256:abc',
        lostReason: 'Failed to copy from device',
      })
      const status = computeFileStatus({ ...baseArgs, file })
      expect(status.isImportFailed).toBe(true)
    })
  })

  describe('fileIsGone', () => {
    it('is true when file has lostReason', () => {
      const file = makeFileRecord({
        hash: '',
        lostReason: 'No local file or source available',
      })
      const status = computeFileStatus({ ...baseArgs, file })
      expect(status.fileIsGone).toBe(true)
    })

    it('is true when file has no local file, no sealed objects, and not processing', () => {
      const file = makeFileRecord({ hash: 'sha256:abc', objects: {} })
      const status = computeFileStatus({ ...baseArgs, file })
      expect(status.fileIsGone).toBe(true)
    })

    it('is false when file is still processing (hash empty, no lostReason)', () => {
      const file = makeFileRecord({ hash: '' })
      const status = computeFileStatus({ ...baseArgs, file })
      expect(status.fileIsGone).toBe(false)
    })

    it('is false when file has local URI', () => {
      const file = makeFileRecord()
      const status = computeFileStatus({
        ...baseArgs,
        file,
        fileUri: '/local/file.jpg',
      })
      expect(status.fileIsGone).toBe(false)
    })
  })

  describe('errorText', () => {
    it('shows import failed text when lostReason is set', () => {
      const file = makeFileRecord({
        hash: '',
        lostReason: 'Source photo deleted from device',
      })
      const status = computeFileStatus({ ...baseArgs, file })
      expect(status.errorText).toBe('Import failed')
    })
  })
})
