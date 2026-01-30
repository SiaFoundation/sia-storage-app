import { Alert, View } from 'react-native'
import { resetApp } from '../managers/app'
import { Button } from './Button'
import { GroupTitle } from './Group'

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
            ],
          )
        }}
      >
        Reset application
      </Button>
    </View>
  )
}
