import { releaseGrant } from 'import-sources'
import { deleteImportWithCleanup } from './importDelete'
import { removeStagedFile } from './importStaging'
import { app } from '../stores/appService'

jest.mock('./importStaging', () => ({
  removeStagedFile: jest.fn(async () => {}),
}))
jest.mock('../stores/appService', () => ({ app: jest.fn() }))

describe('deleteImportWithCleanup', () => {
  it('releases every returned grant (incl. the tree grant) and removes staged bytes', async () => {
    const files = jest.fn(async () => [
      { sourceKind: 'staged', sourceUri: 'file:///docs/import-staging/a.jpg' },
      { sourceKind: 'bookmark', sourceUri: null },
    ])
    const del = jest.fn(async () => ['android-uri:doc1', 'android-uri:tree'])
    jest.mocked(app).mockReturnValue({
      imports: { files, delete: del },
    } as unknown as ReturnType<typeof app>)

    await deleteImportWithCleanup('imp1')

    expect(del).toHaveBeenCalledWith('imp1')
    expect(jest.mocked(releaseGrant)).toHaveBeenCalledWith('android-uri:doc1')
    expect(jest.mocked(releaseGrant)).toHaveBeenCalledWith('android-uri:tree')
    expect(jest.mocked(removeStagedFile)).toHaveBeenCalledWith('file:///docs/import-staging/a.jpg')
  })

  it('the delete proceeds even when the staged-row scan fails', async () => {
    const del = jest.fn(async () => [])
    jest.mocked(app).mockReturnValue({
      imports: { files: jest.fn(async () => Promise.reject(new Error('db'))), delete: del },
    } as unknown as ReturnType<typeof app>)

    await deleteImportWithCleanup('imp1')
    expect(del).toHaveBeenCalled()
  })
})
