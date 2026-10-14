import { act, fireEvent, render, screen } from '@testing-library/react-native'
import { DownloadPanel } from './DownloadPanel'

// The shared setup replaces react-native with a stub that has no components.
jest.unmock('react-native')
// The icons and the progress ring draw with react-native-svg, which does not
// load under jest.
jest.mock('lucide-react-native', () => ({
  CloudAlertIcon: () => null,
  CloudDownloadIcon: () => null,
  CloudOffIcon: () => null,
}))
jest.mock('../CircularProgress', () => ({ CircularProgress: () => null }))

const MB = 1_000_000

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('DownloadPanel', () => {
  it('a tap shows Starting until the request settles, then where the download is', async () => {
    const request = deferred()
    const onPress = jest.fn(() => request.promise)
    const view = render(
      <DownloadPanel size={40 * MB} entry={undefined} isConnected onPress={onPress} />,
    )

    fireEvent.press(screen.getByTestId('download-panel'))
    expect(screen.getByText('Starting download')).toBeTruthy()

    view.rerender(
      <DownloadPanel
        size={40 * MB}
        entry={{ id: 'f', status: 'downloading', progress: 0.25 }}
        isConnected
        onPress={onPress}
      />,
    )
    await act(async () => request.resolve())
    expect(screen.getByText('Downloading 25%')).toBeTruthy()
    expect(screen.getByText('10.0 MB of 40.0 MB')).toBeTruthy()
  })

  it('a retry that registers and fails again before a render shows the failure, not Starting', async () => {
    const failed = { id: 'f', status: 'error' as const, progress: 0, error: 'host timed out' }
    const request = deferred()
    render(
      <DownloadPanel size={40 * MB} entry={failed} isConnected onPress={() => request.promise} />,
    )

    fireEvent.press(screen.getByTestId('download-panel'))
    expect(screen.getByText('Starting download')).toBeTruthy()
    await act(async () => request.resolve())

    expect(screen.getByText('Download failed')).toBeTruthy()
  })

  it('a refused tap goes back to Download', async () => {
    const onPress = jest.fn(async () => {})
    render(<DownloadPanel size={40 * MB} entry={undefined} isConnected onPress={onPress} />)

    await act(async () => {
      fireEvent.press(screen.getByTestId('download-panel'))
    })

    expect(screen.getByText('Download')).toBeTruthy()
  })

  it('a queued download cannot be tapped again', () => {
    const onPress = jest.fn(async () => {})
    render(
      <DownloadPanel
        size={40 * MB}
        entry={{ id: 'f', status: 'queued', progress: 0 }}
        isConnected
        onPress={onPress}
      />,
    )

    fireEvent.press(screen.getByTestId('download-panel'))

    expect(screen.getByText('Waiting to download')).toBeTruthy()
    expect(onPress).not.toHaveBeenCalled()
  })

  it('a failed download offers another try', () => {
    render(
      <DownloadPanel
        size={40 * MB}
        entry={{ id: 'f', status: 'error', progress: 0, error: 'host timed out' }}
        isConnected
        onPress={jest.fn(async () => {})}
      />,
    )

    expect(screen.getByText('Download failed')).toBeTruthy()
    expect(screen.getByText('Tap to try again')).toBeTruthy()
  })

  it('offline, the button says why it does nothing', () => {
    const onPress = jest.fn(async () => {})
    render(<DownloadPanel size={40 * MB} entry={undefined} isConnected={false} onPress={onPress} />)

    fireEvent.press(screen.getByTestId('download-panel'))

    expect(screen.getByText('Not connected')).toBeTruthy()
    expect(onPress).not.toHaveBeenCalled()
  })
})
