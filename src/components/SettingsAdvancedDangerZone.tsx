import { View, Alert } from 'react-native'
import { resetApp } from '../stores/app'
import { GroupTitle } from './Group'
import { Button } from './Button'

export function SettingsAdvancedDangerZone() {
  return (
    <View>
      <GroupTitle title="Danger Zone" />
      <Button
        variant="danger"
        onPress={() => {
          Alert.alert(
            'Reset Application',
            'This will delete all local metadata. This cannot be undone.',
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Permanently reset',
                style: 'destructive',
                onPress: () => resetApp(),
              },
            ]
          )
        }}
      >
        Reset application
      </Button>
    </View>
  )
}
