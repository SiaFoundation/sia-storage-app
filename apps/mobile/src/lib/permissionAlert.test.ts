import { Alert, Linking, Platform } from 'react-native'
import { showPermissionDeniedAlert } from './permissionAlert'

beforeEach(() => {
  jest.clearAllMocks()
})

describe('showPermissionDeniedAlert', () => {
  it('calls Alert.alert with correct title, message, and two buttons', () => {
    showPermissionDeniedAlert('Test Title', 'Test message.')

    expect(Alert.alert).toHaveBeenCalledWith('Test Title', 'Test message.', [
      { text: 'Cancel', style: 'cancel' },
      expect.objectContaining({ text: 'Open Settings' }),
    ])
  })

  it('opens app-settings URL on iOS', async () => {
    ;(Platform as { OS: string }).OS = 'ios'

    showPermissionDeniedAlert('Title', 'Msg')

    const buttons = (Alert.alert as jest.Mock).mock.calls[0][2]
    const openSettingsButton = buttons.find((b: { text: string }) => b.text === 'Open Settings')
    await openSettingsButton.onPress()

    expect(Linking.openURL).toHaveBeenCalledWith('app-settings:')
  })

  it('falls back to Linking.openSettings if openURL rejects on iOS', async () => {
    ;(Platform as { OS: string }).OS = 'ios'
    ;(Linking.openURL as jest.Mock).mockRejectedValueOnce(new Error('fail'))

    showPermissionDeniedAlert('Title', 'Msg')

    const buttons = (Alert.alert as jest.Mock).mock.calls[0][2]
    const openSettingsButton = buttons.find((b: { text: string }) => b.text === 'Open Settings')
    await openSettingsButton.onPress()

    expect(Linking.openURL).toHaveBeenCalledWith('app-settings:')
    expect(Linking.openSettings).toHaveBeenCalled()
  })

  it('calls Linking.openSettings directly on Android', async () => {
    ;(Platform as { OS: string }).OS = 'android'

    showPermissionDeniedAlert('Title', 'Msg')

    const buttons = (Alert.alert as jest.Mock).mock.calls[0][2]
    const openSettingsButton = buttons.find((b: { text: string }) => b.text === 'Open Settings')
    await openSettingsButton.onPress()

    expect(Linking.openURL).not.toHaveBeenCalled()
    expect(Linking.openSettings).toHaveBeenCalled()
  })
})
