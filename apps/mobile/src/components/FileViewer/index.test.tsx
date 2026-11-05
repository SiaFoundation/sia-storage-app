import type { FileRecord } from '@siastorage/core/types'
import { render } from '@testing-library/react-native'
import { FileViewer } from './index'

// The shared setup replaces react-native with a stub that has no components.
jest.unmock('react-native')
jest.mock('lucide-react-native', () => ({ CloudDownloadIcon: () => null, FileIcon: () => null }))
jest.mock('../MediaConsumers/AudioPlayer', () => ({ AudioPlayer: () => null }))
jest.mock('../MediaConsumers/ImageViewer', () => ({ ImageViewer: () => null }))
jest.mock('../MediaConsumers/JSONViewer', () => ({ JSONViewer: () => null }))
jest.mock('../MediaConsumers/MarkdownViewer', () => ({ MarkdownViewer: () => null }))
jest.mock('../MediaConsumers/PDFViewer', () => ({ PDFViewer: () => null }))
jest.mock('../MediaConsumers/TextViewer', () => ({ TextViewer: () => null }))
jest.mock('../MediaConsumers/VideoPlayer', () => ({ VideoPlayer: () => null }))
jest.mock('./DownloadPanel', () => ({ DownloadPanel: () => null }))
jest.mock('@siastorage/core/stores', () => ({ useDownloadEntry: () => ({ data: undefined }) }))
jest.mock('../../managers/downloader', () => ({ useDownload: () => jest.fn() }))
jest.mock('../../stores/appService', () => ({ app: jest.fn() }))
jest.mock('../../hooks/useIsOnline', () => ({ useIsOnline: () => ({ data: true }) }))
jest.mock('../../stores/sdk', () => ({ useIsConnected: () => true }))
// A file whose copy is on the phone, still loading, so no viewer is drawn.
jest.mock('../../lib/file', () => ({
  assertNever: jest.fn(),
  useFileStatus: () => ({ data: { fileUri: 'file:///files/a.jpg' } }),
}))
jest.mock('../../stores/fs', () => ({ recordFileUse: jest.fn(async () => {}) }))

const { recordFileUse } = jest.requireMock('../../stores/fs') as {
  recordFileUse: jest.Mock
}

const file = { id: 'a', type: 'image/jpeg', name: 'a.jpg', size: 10 } as FileRecord

describe('FileViewer', () => {
  beforeEach(() => recordFileUse.mockClear())

  it('showing a file with a local copy counts as a use of that copy', async () => {
    await render(<FileViewer file={file} />)
    expect(recordFileUse).toHaveBeenCalledWith({ id: 'a', type: 'image/jpeg' })
  })

  it('a page mounted beside the one on screen does not count as a use', async () => {
    const view = await render(<FileViewer file={file} recordUse={false} />)
    expect(recordFileUse).not.toHaveBeenCalled()

    // Swiping to it makes it the page on screen.
    await view.rerender(<FileViewer file={file} recordUse />)
    expect(recordFileUse).toHaveBeenCalledTimes(1)
  })
})
