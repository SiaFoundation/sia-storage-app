import type { FileRecord } from '@siastorage/core/types'
import {
  computeFileStatus,
  deriveCapabilities,
  derivePhase,
  type FileFacts,
  fileRecordEqual,
  getFileCapabilities,
  getFileTypeName,
} from './file'

function makeFacts(overrides?: Partial<FileFacts>): FileFacts {
  return {
    isProcessing: false,
    isImportFailed: false,
    isPinned: false,
    hasLocalCopy: false,
    photosLookup: 'none',
    isShared: false,
    upload: { state: 'idle', progress: 0 },
    download: { state: 'idle', progress: 0 },
    errorText: null,
    ...overrides,
  }
}

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

  describe('unavailable detection (via phase)', () => {
    it('phase is import-failed when file has lostReason', () => {
      const file = makeFileRecord({
        hash: '',
        lostReason: 'No local file or source available',
      })
      const status = computeFileStatus({ ...baseArgs, file })
      expect(status.phase.kind).toBe('import-failed')
    })

    it('phase is unavailable when hashed file has no local, no pin, no Photos', () => {
      const file = makeFileRecord({ hash: 'sha256:abc', objects: {} })
      const status = computeFileStatus({ ...baseArgs, file })
      expect(status.phase.kind).toBe('unavailable')
    })

    it('phase is importing while file is still hashing', () => {
      const file = makeFileRecord({ hash: '' })
      const status = computeFileStatus({ ...baseArgs, file })
      expect(status.phase).toEqual({ kind: 'importing', preview: 'none' })
    })

    it('phase is local-only when only local URI is present', () => {
      const file = makeFileRecord({ objects: {} })
      const status = computeFileStatus({
        ...baseArgs,
        file,
        fileUri: '/local/file.jpg',
      })
      expect(status.phase.kind).toBe('local-only')
    })

    it('phase is importing with preview=pending while Photos lookup is unknown', () => {
      const file = makeFileRecord({ hash: '', localId: 'ph://1' })
      const status = computeFileStatus({ ...baseArgs, file, photosLookup: 'unknown' })
      expect(status.phase).toEqual({ kind: 'importing', preview: 'pending' })
    })

    it('phase is importing with preview=available during import + photos resolved', () => {
      const file = makeFileRecord({ hash: '', localId: 'ph://1' })
      const status = computeFileStatus({
        ...baseArgs,
        file,
        photosLookup: 'available',
        photosDisplayUri: 'file:///photos/1.jpg',
      })
      expect(status.phase).toEqual({ kind: 'importing', preview: 'available' })
    })

    it('phase is unavailable when Photos backup resolves as unavailable', () => {
      const file = makeFileRecord({ hash: 'sha256:abc', objects: {}, localId: 'ph://1' })
      const status = computeFileStatus({ ...baseArgs, file, photosLookup: 'unavailable' })
      expect(status.phase.kind).toBe('unavailable')
    })
  })

  describe('phase derivation (priority-ordered)', () => {
    it('import-failed wins over everything', () => {
      const facts = makeFacts({
        isImportFailed: true,
        isProcessing: true,
        isPinned: true,
        hasLocalCopy: true,
        upload: { state: 'uploading', progress: 0.5 },
        errorText: 'boom',
      })
      const phase = derivePhase(facts)
      expect(phase).toEqual({ kind: 'import-failed', reason: 'boom' })
    })

    it('importing carries preview sub-state derived from photosLookup', () => {
      expect(derivePhase(makeFacts({ isProcessing: true }))).toEqual({
        kind: 'importing',
        preview: 'none',
      })
      expect(derivePhase(makeFacts({ isProcessing: true, photosLookup: 'unknown' }))).toEqual({
        kind: 'importing',
        preview: 'pending',
      })
      expect(derivePhase(makeFacts({ isProcessing: true, photosLookup: 'available' }))).toEqual({
        kind: 'importing',
        preview: 'available',
      })
      expect(derivePhase(makeFacts({ isProcessing: true, photosLookup: 'unavailable' }))).toEqual({
        kind: 'importing',
        preview: 'none',
      })
    })

    it('upload-errored only when not pinned', () => {
      expect(
        derivePhase(makeFacts({ upload: { state: 'errored', progress: 0 }, errorText: 'oops' })),
      ).toEqual({ kind: 'upload-errored', error: 'oops' })
      // Already pinned: errored upload is stale, fall through to pinned phases
      expect(
        derivePhase(
          makeFacts({
            isPinned: true,
            hasLocalCopy: true,
            upload: { state: 'errored', progress: 0 },
          }),
        ),
      ).toEqual({ kind: 'pinned-and-local' })
    })

    it('uploading kinds carry progress + queued/packing flags', () => {
      expect(derivePhase(makeFacts({ upload: { state: 'queued', progress: 0 } }))).toEqual({
        kind: 'uploading',
        progress: 0,
        isPacking: false,
        isQueued: true,
      })
      expect(derivePhase(makeFacts({ upload: { state: 'packing', progress: 0.1 } }))).toEqual({
        kind: 'uploading',
        progress: 0.1,
        isPacking: true,
        isQueued: false,
      })
      expect(derivePhase(makeFacts({ upload: { state: 'uploading', progress: 0.5 } }))).toEqual({
        kind: 'uploading',
        progress: 0.5,
        isPacking: false,
        isQueued: false,
      })
    })

    it('downloading carries progress + queued flag', () => {
      expect(
        derivePhase(
          makeFacts({ isPinned: true, download: { state: 'downloading', progress: 0.3 } }),
        ),
      ).toEqual({ kind: 'downloading', progress: 0.3, isQueued: false })
      expect(
        derivePhase(makeFacts({ isPinned: true, download: { state: 'queued', progress: 0 } })),
      ).toEqual({ kind: 'downloading', progress: 0, isQueued: true })
    })

    it('pinned-and-local when both pinned and local copy', () => {
      expect(derivePhase(makeFacts({ isPinned: true, hasLocalCopy: true }))).toEqual({
        kind: 'pinned-and-local',
      })
    })

    it('pinned-remote-only when pinned but no local copy', () => {
      expect(derivePhase(makeFacts({ isPinned: true }))).toEqual({ kind: 'pinned-remote-only' })
    })

    it('local-only when local copy but never pinned', () => {
      expect(derivePhase(makeFacts({ hasLocalCopy: true }))).toEqual({ kind: 'local-only' })
    })

    it('unavailable when nothing else applies (orphan: hashed, no local, no pin)', () => {
      // This is the unreachable-in-healthy-code state: cache eviction
      // skips unpinned files, so a hashed file always has either a local
      // copy or sealed objects. If something ever leaves us here, we land
      // in unavailable regardless of photosLookup state.
      expect(derivePhase(makeFacts())).toEqual({ kind: 'unavailable' })
      expect(derivePhase(makeFacts({ photosLookup: 'unknown' }))).toEqual({ kind: 'unavailable' })
      expect(derivePhase(makeFacts({ photosLookup: 'available' }))).toEqual({
        kind: 'unavailable',
      })
      expect(derivePhase(makeFacts({ photosLookup: 'unavailable' }))).toEqual({
        kind: 'unavailable',
      })
    })
  })

  describe('capabilities', () => {
    it('canShare requires literal pin (not isShared)', () => {
      expect(deriveCapabilities(makeFacts({ isShared: true })).canShare).toBe(false)
      expect(deriveCapabilities(makeFacts({ isPinned: true })).canShare).toBe(true)
    })

    it('isOnNetwork is pin OR shared', () => {
      expect(deriveCapabilities(makeFacts()).isOnNetwork).toBe(false)
      expect(deriveCapabilities(makeFacts({ isShared: true })).isOnNetwork).toBe(true)
      expect(deriveCapabilities(makeFacts({ isPinned: true })).isOnNetwork).toBe(true)
    })

    it('canDownload needs network + no local; blocked while in flight; allowed when errored (retry)', () => {
      expect(deriveCapabilities(makeFacts({ isPinned: true })).canDownload).toBe(true)
      expect(
        deriveCapabilities(makeFacts({ isPinned: true, hasLocalCopy: true })).canDownload,
      ).toBe(false)
      expect(
        deriveCapabilities(
          makeFacts({ isPinned: true, download: { state: 'downloading', progress: 0 } }),
        ).canDownload,
      ).toBe(false)
      expect(
        deriveCapabilities(
          makeFacts({ isPinned: true, download: { state: 'queued', progress: 0 } }),
        ).canDownload,
      ).toBe(false)
      // Errored should NOT block — user must be able to retry from the action sheet.
      expect(
        deriveCapabilities(
          makeFacts({ isPinned: true, download: { state: 'errored', progress: 0 } }),
        ).canDownload,
      ).toBe(true)
    })

    it('canUpload needs local + not pinned; blocked while in flight; allowed when errored (retry)', () => {
      expect(deriveCapabilities(makeFacts({ hasLocalCopy: true })).canUpload).toBe(true)
      expect(deriveCapabilities(makeFacts({ hasLocalCopy: true, isPinned: true })).canUpload).toBe(
        false,
      )
      expect(
        deriveCapabilities(
          makeFacts({ hasLocalCopy: true, upload: { state: 'queued', progress: 0 } }),
        ).canUpload,
      ).toBe(false)
      // Errored should NOT block — user must be able to retry from the action sheet.
      expect(
        deriveCapabilities(
          makeFacts({ hasLocalCopy: true, upload: { state: 'errored', progress: 0 } }),
        ).canUpload,
      ).toBe(true)
    })

    it('canPlay covers local and photos only — not shared+pinned without local copy', () => {
      expect(deriveCapabilities(makeFacts({ hasLocalCopy: true })).canPlay).toBe(true)
      expect(deriveCapabilities(makeFacts({ photosLookup: 'available' })).canPlay).toBe(true)
      expect(deriveCapabilities(makeFacts({ isShared: true, isPinned: true })).canPlay).toBe(false)
      expect(deriveCapabilities(makeFacts()).canPlay).toBe(false)
    })

    it('canAutoFetch is network && !local', () => {
      expect(deriveCapabilities(makeFacts({ isPinned: true })).canAutoFetch).toBe(true)
      expect(
        deriveCapabilities(makeFacts({ isPinned: true, hasLocalCopy: true })).canAutoFetch,
      ).toBe(false)
    })
  })

  describe('getFileCapabilities (bulk-op helper)', () => {
    it('matches deriveCapabilities for raw inputs (idle, no share, no photos)', () => {
      const file = makeFileRecord({
        objects: { 'https://indexer': {} as any },
      })
      const caps = getFileCapabilities(file, null)
      expect(caps.isOnNetwork).toBe(true)
      expect(caps.canShare).toBe(true)
      expect(caps.canDownload).toBe(true)
      expect(caps.canUpload).toBe(false)
    })

    it('canUpload true when fileUri present and no objects', () => {
      const file = makeFileRecord({ objects: {} })
      const caps = getFileCapabilities(file, '/local/file.jpg')
      expect(caps.canUpload).toBe(true)
      expect(caps.canDownload).toBe(false)
      expect(caps.isOnNetwork).toBe(false)
    })
  })

  describe('photosLookup and displayUri', () => {
    it('defaults photosLookup to none and exposes empty displayUri when no fileUri', () => {
      const file = makeFileRecord()
      const status = computeFileStatus({ ...baseArgs, file })
      expect(status.photosLookup).toBe('none')
      expect(status.photosDisplayUri).toBe(null)
      expect(status.displayUri).toBe(null)
    })

    it('prefers fileUri over photosDisplayUri in displayUri', () => {
      const file = makeFileRecord()
      const status = computeFileStatus({
        ...baseArgs,
        file,
        fileUri: '/local/file.jpg',
        photosLookup: 'available',
        photosDisplayUri: 'file:///photos/1.jpg',
      })
      expect(status.displayUri).toBe('/local/file.jpg')
    })

    it('falls back to photosDisplayUri when fileUri is null', () => {
      const file = makeFileRecord({ hash: 'sha256:abc', objects: {}, localId: 'ph://1' })
      const status = computeFileStatus({
        ...baseArgs,
        file,
        photosLookup: 'available',
        photosDisplayUri: 'file:///photos/1.jpg',
      })
      expect(status.displayUri).toBe('file:///photos/1.jpg')
    })
  })

  describe('errorText', () => {
    it('surfaces the file.lostReason verbatim — not a generic "Import failed"', () => {
      const file = makeFileRecord({
        hash: '',
        lostReason: 'Source photo deleted from device',
      })
      const status = computeFileStatus({ ...baseArgs, file })
      expect(status.errorText).toBe('Source photo deleted from device')
      // And it propagates into the import-failed phase reason, so consumers
      // reading phase.reason get the specific cause too.
      expect(status.phase).toEqual({
        kind: 'import-failed',
        reason: 'Source photo deleted from device',
      })
    })

    it('falls back through upload → download → explicit', () => {
      const file = makeFileRecord()
      const uploadErr = computeFileStatus({
        ...baseArgs,
        file,
        uploadState: { id: file.id, size: 0, progress: 0, status: 'error', error: 'upload boom' },
      })
      expect(uploadErr.errorText).toBe('upload boom')

      const downloadErr = computeFileStatus({
        ...baseArgs,
        file,
        downloadState: { id: file.id, status: 'error', progress: 0, error: 'download boom' },
      })
      expect(downloadErr.errorText).toBe('download boom')

      const explicit = computeFileStatus({ ...baseArgs, file, errorText: 'fallback boom' })
      expect(explicit.errorText).toBe('fallback boom')
    })
  })

  describe('derivePhase exhaustiveness', () => {
    it('every FilePhase kind is reachable from some FileFacts shape', () => {
      const seen = new Set<string>()
      const visit = (facts: FileFacts) => seen.add(derivePhase(facts).kind)

      visit(makeFacts({ isImportFailed: true }))
      visit(makeFacts({ isProcessing: true }))
      visit(makeFacts({ upload: { state: 'errored', progress: 0 } }))
      visit(makeFacts({ upload: { state: 'uploading', progress: 0.5 } }))
      visit(makeFacts({ download: { state: 'downloading', progress: 0.5 } }))
      visit(makeFacts({ isPinned: true, hasLocalCopy: true }))
      visit(makeFacts({ isPinned: true, hasLocalCopy: false }))
      visit(makeFacts({ hasLocalCopy: true }))
      visit(makeFacts())

      expect(seen).toEqual(
        new Set([
          'import-failed',
          'importing',
          'upload-errored',
          'uploading',
          'downloading',
          'pinned-and-local',
          'pinned-remote-only',
          'local-only',
          'unavailable',
        ]),
      )
    })
  })

  describe('isPinned vs isOnNetwork', () => {
    it('isPinned is false when shared but not sealed (no objects)', () => {
      const file = makeFileRecord({ objects: {} })
      const status = computeFileStatus({ ...baseArgs, file, isShared: true })
      expect(status.isPinned).toBe(false)
    })

    it('isOnNetwork is true when shared, even without sealed objects', () => {
      const file = makeFileRecord({ objects: {} })
      const status = computeFileStatus({ ...baseArgs, file, isShared: true })
      expect(status.isOnNetwork).toBe(true)
    })

    it('isPinned is true when sealed, regardless of isShared', () => {
      const file = makeFileRecord({
        objects: { 'https://indexer.example.com': {} as any },
      })
      const status = computeFileStatus({ ...baseArgs, file })
      expect(status.isPinned).toBe(true)
      expect(status.isOnNetwork).toBe(true)
    })

    it('isOnNetwork is false when not sealed and not shared', () => {
      const file = makeFileRecord({ objects: {} })
      const status = computeFileStatus({ ...baseArgs, file })
      expect(status.isPinned).toBe(false)
      expect(status.isOnNetwork).toBe(false)
    })
  })
})

describe('getFileTypeName', () => {
  describe('image/* → photo', () => {
    const cases = [
      'image/jpeg',
      'image/png',
      'image/heic',
      'image/heic-sequence',
      'image/bmp',
      'image/avif',
      'image/x-canon-cr3',
    ]
    it.each(cases)('%s', (type) => {
      expect(getFileTypeName(makeFileRecord({ type }))).toBe('photo')
    })
  })

  describe('video/* → video', () => {
    const cases = [
      'video/mp4',
      'video/quicktime',
      'video/x-msvideo',
      'video/x-matroska',
      'video/webm',
    ]
    it.each(cases)('%s', (type) => {
      expect(getFileTypeName(makeFileRecord({ type }))).toBe('video')
    })
  })

  describe('audio/* → audio', () => {
    const cases = ['audio/mpeg', 'audio/mp4', 'audio/flac', 'audio/ogg', 'audio/aiff']
    it.each(cases)('%s', (type) => {
      expect(getFileTypeName(makeFileRecord({ type }))).toBe('audio')
    })
  })

  // application/* maps to 'document', so archives and installers all read as
  // documents in UI surfaces using this label.
  describe('application/* → document', () => {
    const cases = [
      'application/pdf',
      'application/zip',
      'application/x-bzip2',
      'application/json',
      'application/vnd.android.package-archive',
      'application/x-apple-diskimage',
    ]
    it.each(cases)('%s', (type) => {
      expect(getFileTypeName(makeFileRecord({ type }))).toBe('document')
    })
  })

  describe('text/* and unknown → other', () => {
    const cases = ['text/plain', 'text/markdown', 'text/csv', 'foo/bar']
    it.each(cases)('%s', (type) => {
      expect(getFileTypeName(makeFileRecord({ type }))).toBe('other')
    })
  })
})
