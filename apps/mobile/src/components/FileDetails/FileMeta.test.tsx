import type { FileRecord } from '@siastorage/core/types'
import { act, render } from '@testing-library/react-native'
import { FileMeta } from './FileMeta'

// The shared setup replaces react-native with a stub that has no components.
jest.unmock('react-native')
jest.mock('lucide-react-native', () => ({ PencilIcon: () => null, PlusIcon: () => null }))
jest.mock('@siastorage/core/stores', () => ({
  useShowAdvanced: () => ({ data: false }),
  useTagsForFile: () => ({ data: [] }),
}))
jest.mock('swr', () => ({ __esModule: true, default: () => ({ data: undefined }) }))
jest.mock('../../hooks/usePinnedObjects', () => ({ usePinnedObjects: () => ({ data: [] }) }))
jest.mock('../BulkManageTagsSheet', () => ({ BulkManageTagsSheet: () => null }))
jest.mock('@react-native-clipboard/clipboard', () => ({ setString: jest.fn() }))
jest.mock('./FileMap', () => ({ FileMap: () => null }))
jest.mock('../RenameSheet', () => ({ RenameSheet: jest.fn(() => null) }))
jest.mock('../../stores/appService', () => ({ app: jest.fn() }))
jest.mock('../../stores/sheets', () => ({ openSheet: jest.fn() }))

const { RenameSheet } = jest.requireMock('../RenameSheet') as { RenameSheet: jest.Mock }
const { app } = jest.requireMock('../../stores/appService') as { app: jest.Mock }

const file = {
  id: 'v2',
  name: 'notes.txt',
  type: 'text/plain',
  size: 10,
  createdAt: 1000,
  updatedAt: 2000,
} as FileRecord

describe('FileMeta', () => {
  it('renaming from the details screen renames every version of the file', async () => {
    const renameFile = jest.fn(async () => {})
    const update = jest.fn(async () => {})
    app.mockReturnValue({ files: { renameFile, update }, caches: { thumbnails: {} } })

    await render(<FileMeta file={file} status={{} as never} />)
    const { onRename } = RenameSheet.mock.calls.at(-1)![0]
    await act(() => onRename('ideas.txt'))

    expect(renameFile).toHaveBeenCalledWith('v2', 'ideas.txt')
    expect(update).not.toHaveBeenCalled()
  })
})
