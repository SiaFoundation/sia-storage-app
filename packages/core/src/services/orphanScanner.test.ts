import type { AppService } from '../app/service'
import { runOrphanScanner } from './orphanScanner'

/**
 * The sweep deletes local files with no database row behind them. Claim-scoped
 * import temps (`<id>.<token>.tmp`) are the hazard: they are named differently
 * from finalized files and are live bytes mid-copy, so a wrong id split or a
 * wrong exemption lookup deletes a copy that is still being written.
 */
function mockApp(
  over: {
    files?: string[]
    orphanedIds?: string[]
    inFlightIds?: string[]
  } = {},
) {
  const removeFile = jest.fn(async () => {})
  const removeFileByPath = jest.fn(async () => {})
  const findOrphanedFileIds = jest.fn(async () => new Set(over.orphanedIds ?? []))
  const inFlightImportFileIds = jest.fn(async () => new Set(over.inFlightIds ?? []))
  const deleteMetaBatch = jest.fn(async () => {})
  const app = {
    fs: {
      listFiles: jest.fn(async () => over.files ?? []),
      findOrphanedFileIds,
      inFlightImportFileIds,
      removeFile,
      removeFileByPath,
      deleteMetaBatch,
    },
  } as unknown as AppService
  return {
    app,
    removeFile,
    removeFileByPath,
    findOrphanedFileIds,
    inFlightImportFileIds,
    deleteMetaBatch,
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
    const m = mockApp({ files: ['/data/xyz.jpg'], orphanedIds: [] })
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
