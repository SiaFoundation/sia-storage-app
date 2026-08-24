import type { AppService } from '../app/service'
import { runOrphanScanner } from './orphanScanner'

/**
 * The sweep deletes local files with no database row behind them. Two hazards
 * shape it: claim-scoped import temps (`<id>.<token>.tmp`) are live bytes
 * mid-copy, and a file whose bytes sit at a stale extension looks exactly like
 * an orphan from disk. Both must survive it.
 */
function mockApp(
  over: {
    files?: string[]
    orphanedIds?: string[]
    inFlightIds?: string[]
    /** fileId -> stored type, i.e. the rows the library still holds. */
    liveTypes?: Record<string, string>
  } = {},
) {
  const removeFile = jest.fn(async () => {})
  const removeFileByPath = jest.fn(async () => {})
  const findOrphanedFileIds = jest.fn(async () => new Set(over.orphanedIds ?? []))
  const inFlightImportFileIds = jest.fn(async () => new Set(over.inFlightIds ?? []))
  const liveFileTypes = jest.fn(async (ids: string[]) => {
    const live = over.liveTypes ?? {}
    return new Map(ids.filter((id) => id in live).map((id) => [id, live[id]]))
  })
  const deleteMetaBatch = jest.fn(async () => {})
  const renameToType = jest.fn(async () => ({ uri: 'file://renamed' }))
  const getFileUri = jest.fn(async () => 'file://restored')
  const app = {
    fs: {
      listFiles: jest.fn(async () => over.files ?? []),
      findOrphanedFileIds,
      inFlightImportFileIds,
      liveFileTypes,
      removeFile,
      removeFileByPath,
      deleteMetaBatch,
      renameToType,
      getFileUri,
    },
  } as unknown as AppService
  return {
    app,
    removeFile,
    removeFileByPath,
    findOrphanedFileIds,
    inFlightImportFileIds,
    liveFileTypes,
    deleteMetaBatch,
    renameToType,
    getFileUri,
  }
}

describe('runOrphanScanner claim temps', () => {
  it('keeps a temp whose base id has an in-flight import row', async () => {
    const m = mockApp({ files: ['/data/abc.tok1.tmp'], inFlightIds: ['abc'] })
    const res = await runOrphanScanner(m.app)
    expect(m.removeFileByPath).not.toHaveBeenCalled()
    expect(m.removeFile).not.toHaveBeenCalled()
    expect(res?.removed).toBe(0)
  })

  it('deletes a temp with no in-flight row by its literal path', async () => {
    const m = mockApp({ files: ['/data/abc.tok1.tmp'], inFlightIds: [] })
    const res = await runOrphanScanner(m.app)
    // By path, because `<id>.<token>.tmp` cannot be rebuilt from id + type.
    expect(m.removeFileByPath).toHaveBeenCalledWith('/data/abc.tok1.tmp')
    expect(m.removeFile).not.toHaveBeenCalled()
    expect(res?.removed).toBe(1)
  })

  it('looks the temp up under its base id, not `<id>.<token>`', async () => {
    const m = mockApp({ files: ['/data/abc.tok1.tmp'], inFlightIds: ['abc'] })
    await runOrphanScanner(m.app)
    // The whole point of the split: keying off 'abc.tok1' would miss the
    // exemption and delete a copy in progress.
    expect(m.inFlightImportFileIds).toHaveBeenCalledWith(['abc'])
  })

  it('judges a temp by in-flight rows alone, even when its base id is a live file', async () => {
    // The base id belongs to a finalized file, so it is not orphaned; the
    // leftover temp must still go, or it is protected forever.
    const m = mockApp({ files: ['/data/abc.tok1.tmp'], orphanedIds: [], inFlightIds: [] })
    const res = await runOrphanScanner(m.app)
    expect(m.removeFileByPath).toHaveBeenCalledWith('/data/abc.tok1.tmp')
    expect(res?.removed).toBe(1)
  })

  it('still deletes a non-temp orphan by id and type', async () => {
    const m = mockApp({ files: ['/data/xyz.jpg'], orphanedIds: ['xyz'] })
    const res = await runOrphanScanner(m.app)
    expect(m.removeFile).toHaveBeenCalledWith({ id: 'xyz', type: 'image/jpeg' })
    expect(m.removeFileByPath).not.toHaveBeenCalled()
    expect(res?.removed).toBe(1)
  })

  it('keeps a non-temp file that is not orphaned', async () => {
    const m = mockApp({
      files: ['/data/xyz.jpg'],
      orphanedIds: [],
      liveTypes: { xyz: 'image/jpeg' },
    })
    const res = await runOrphanScanner(m.app)
    expect(m.removeFile).not.toHaveBeenCalled()
    expect(res?.removed).toBe(0)
  })

  it('only asks about temp ids when looking up in-flight rows', async () => {
    const m = mockApp({
      files: ['/data/abc.tok1.tmp', '/data/xyz.jpg'],
      orphanedIds: [],
      inFlightIds: ['abc'],
    })
    await runOrphanScanner(m.app)
    expect(m.inFlightImportFileIds).toHaveBeenCalledWith(['abc'])
  })
})

describe('runOrphanScanner type drift', () => {
  it('moves a live file whose bytes sit at a stale extension instead of deleting it', async () => {
    // The shape an edited raw import leaves: the row says JPEG, which is what
    // the rendered bytes are, while they sit under the staged `.cr3`.
    const m = mockApp({
      files: ['/data/abc.cr3'],
      orphanedIds: ['abc'],
      liveTypes: { abc: 'image/jpeg' },
    })
    const res = await runOrphanScanner(m.app)
    expect(m.renameToType).toHaveBeenCalledWith(
      { id: 'abc', type: 'image/x-canon-cr3' },
      'image/jpeg',
    )
    expect(m.removeFile).not.toHaveBeenCalled()
    expect(m.removeFileByPath).not.toHaveBeenCalled()
    expect(res).toEqual({ removed: 0, repaired: 1 })
  })

  it('rebuilds the fs row for a file it moved back', async () => {
    // The missing fs row is what hid the file; the move alone fixes nothing.
    const m = mockApp({
      files: ['/data/abc.cr3'],
      orphanedIds: ['abc'],
      liveTypes: { abc: 'image/jpeg' },
    })
    await runOrphanScanner(m.app)
    expect(m.getFileUri).toHaveBeenCalledWith({ id: 'abc', type: 'image/jpeg' })
    expect(m.deleteMetaBatch).not.toHaveBeenCalled()
  })

  it('drops the stale copy when the row already resolves to real bytes', async () => {
    const m = mockApp({
      files: ['/data/abc.cr3', '/data/abc.jpg'],
      orphanedIds: [],
      liveTypes: { abc: 'image/jpeg' },
    })
    const res = await runOrphanScanner(m.app)
    expect(m.removeFileByPath).toHaveBeenCalledWith('/data/abc.cr3')
    expect(m.renameToType).not.toHaveBeenCalled()
    expect(res?.removed).toBe(1)
  })

  it('rebuilds a missing fs row rather than deleting bytes the library points at', async () => {
    const m = mockApp({
      files: ['/data/abc.jpg'],
      orphanedIds: ['abc'],
      liveTypes: { abc: 'image/jpeg' },
    })
    const res = await runOrphanScanner(m.app)
    expect(m.removeFile).not.toHaveBeenCalled()
    expect(m.getFileUri).toHaveBeenCalledWith({ id: 'abc', type: 'image/jpeg' })
    expect(m.deleteMetaBatch).not.toHaveBeenCalled()
    expect(res?.removed).toBe(0)
  })

  it('moves a file stored under the generic extension once its type is known', async () => {
    // extFromMime's fallback for a type that names no format. Nothing maps
    // `.bin` back to a type, so without handling it these stay stranded.
    const m = mockApp({
      files: ['/data/abc.bin'],
      orphanedIds: ['abc'],
      liveTypes: { abc: 'image/jpeg' },
    })
    const res = await runOrphanScanner(m.app)
    expect(m.renameToType).toHaveBeenCalledWith(
      { id: 'abc', type: 'application/octet-stream' },
      'image/jpeg',
    )
    expect(res).toEqual({ removed: 0, repaired: 1 })
  })

  it.each([['/data/abc.unknownext'], ['/data/abc.jpeg']])(
    'leaves %s alone rather than guess at a move, since no writer produces that path',
    async (file) => {
      // Not a path this code wrote, but still a live row's bytes.
      const m = mockApp({
        files: [file],
        orphanedIds: ['abc'],
        liveTypes: { abc: 'image/jpeg' },
      })
      const res = await runOrphanScanner(m.app)
      expect(m.removeFile).not.toHaveBeenCalled()
      expect(m.removeFileByPath).not.toHaveBeenCalled()
      expect(m.renameToType).not.toHaveBeenCalled()
      expect(res).toEqual({ removed: 0, repaired: 0 })
    },
  )

  it('still drops the fs row of an id it deleted', async () => {
    const m = mockApp({ files: ['/data/xyz.jpg'], orphanedIds: ['xyz'] })
    await runOrphanScanner(m.app)
    expect(m.deleteMetaBatch).toHaveBeenCalledWith(['xyz'])
  })
})
