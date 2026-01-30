import { Alert } from 'react-native'
import { resetData } from '../managers/app'
import { librarySwr } from '../stores/library'
import { Button } from './Button'

/**
 * Button to reset the database and resync from the indexer.
 * This button should almost never be shown to the user, only
 * when there is a database query issue which should only
 * be on test and dev builds.
 */
export function LibraryLocalResetButton() {
  return (
    <Button
      variant="danger"
      style={{ width: '100%', marginTop: 12 }}
      onPress={() => {
        Alert.alert(
          'Reset Data',
          'This will reset your library and resync from the indexer. This cannot be undone and you will lose any files that have not been uploaded. Continue?',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Reset',
              style: 'destructive',
              onPress: async () => {
                await resetData()
                librarySwr.triggerChange()
              },
            },
          ],
        )
      }}
    >
      Reset library
    </Button>
  )
}
