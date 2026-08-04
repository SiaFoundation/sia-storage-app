import { releaseGrant } from 'import-sources'
import { deleteImportWithCleanup } from './importDelete'
import { removeStagedFile } from './importStaging'
import { app } from '../stores/appService'

jest.mock('./importStaging', () => ({
  removeStagedFile: jest.fn(async () => {}),
}))
jest.mock('../stores/appService', () => ({ app: jest.fn() }))

describe('deleteImportWithCleanup', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('releases every returned grant and removes every returned staged uri', async () => {
    const del = jest.fn(async () => ({
      refs: ['android-uri:doc1', 'android-uri:tree'],
      stagedUris: ['file:///docs/import-staging/a.jpg'],
    }))
    jest.mocked(app).mockReturnValue({
      imports: { delete: del },
    } as unknown as ReturnType<typeof app>)

    await deleteImportWithCleanup('imp1')

    expect(del).toHaveBeenCalledWith('imp1')
    expect(jest.mocked(releaseGrant)).toHaveBeenCalledWith('android-uri:doc1')
    expect(jest.mocked(releaseGrant)).toHaveBeenCalledWith('android-uri:tree')
    expect(jest.mocked(removeStagedFile)).toHaveBeenCalledWith('file:///docs/import-staging/a.jpg')
  })

  it('a delete with nothing to clean up releases and removes nothing', async () => {
    const del = jest.fn(async () => ({ refs: [], stagedUris: [] }))
    jest.mocked(app).mockReturnValue({
      imports: { delete: del },
    } as unknown as ReturnType<typeof app>)

    await deleteImportWithCleanup('imp1')

    expect(del).toHaveBeenCalledWith('imp1')
    expect(jest.mocked(releaseGrant)).not.toHaveBeenCalled()
    expect(jest.mocked(removeStagedFile)).not.toHaveBeenCalled()
  })
})
