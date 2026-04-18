import { Alert, Linking, Platform } from 'react-native'

export function showPermissionDeniedAlert(title: string, message: string) {
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    {
      text: 'Open Settings',
      onPress: () => {
        if (Platform.OS === 'ios') {
          Linking.openURL('app-settings:').catch(() => {
            Linking.openSettings().catch(() => {})
          })
        } else {
          Linking.openSettings().catch(() => {})
        }
      },
    },
  ])
}
