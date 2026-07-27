import { Linking } from 'react-native'
import InAppBrowser from 'react-native-inappbrowser-reborn'
import { openExternalURL } from './inAppBrowser'

jest.mock('react-native-inappbrowser-reborn', () => ({
  __esModule: true,
  default: {
    isAvailable: jest.fn(async () => true),
    open: jest.fn(async () => ({ type: 'dismiss' })),
  },
}))

const mockIsAvailable = InAppBrowser.isAvailable as jest.Mock
const mockOpen = InAppBrowser.open as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  mockIsAvailable.mockResolvedValue(true)
})

describe('openExternalURL', () => {
  it('opens http URLs in the in-app browser', async () => {
    await openExternalURL('http://sia.tech/')

    expect(mockOpen).toHaveBeenCalledWith('http://sia.tech/', expect.any(Object))
    expect(Linking.openURL).not.toHaveBeenCalled()
  })

  it('opens https URLs in the in-app browser', async () => {
    await openExternalURL('https://sia.tech/')

    expect(mockOpen).toHaveBeenCalledWith('https://sia.tech/', expect.any(Object))
    expect(Linking.openURL).not.toHaveBeenCalled()
  })

  it('falls back to Linking for web URLs when the in-app browser is unavailable', async () => {
    mockIsAvailable.mockResolvedValue(false)

    await openExternalURL('https://sia.tech/')

    expect(mockOpen).not.toHaveBeenCalled()
    expect(Linking.openURL).toHaveBeenCalledWith('https://sia.tech/')
  })

  it('falls back to Linking for web URLs when the in-app browser throws', async () => {
    mockIsAvailable.mockRejectedValue(new Error('boom'))

    await openExternalURL('https://sia.tech/')

    expect(Linking.openURL).toHaveBeenCalledWith('https://sia.tech/')
  })

  // Regression test for #693: mailto: links did nothing on Android because they
  // were routed through the in-app browser (a web browser that can't dispatch
  // mailto:). They must bypass InAppBrowser and go straight to the system handler.
  it('routes mailto: links straight to Linking, bypassing the in-app browser', async () => {
    await openExternalURL('mailto:hello@sia.tech')

    expect(mockIsAvailable).not.toHaveBeenCalled()
    expect(mockOpen).not.toHaveBeenCalled()
    expect(Linking.openURL).toHaveBeenCalledWith('mailto:hello@sia.tech')
  })

  it('routes tel: links straight to Linking, bypassing the in-app browser', async () => {
    await openExternalURL('tel:+15551234567')

    expect(mockOpen).not.toHaveBeenCalled()
    expect(Linking.openURL).toHaveBeenCalledWith('tel:+15551234567')
  })
})
