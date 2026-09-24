import { Alert } from 'react-native'
import RNFS from 'react-native-fs'
import Share from 'react-native-share'
import { copyDatabaseTo } from '../db'
import { InsetGroupLink, InsetGroupSection } from './InsetGroup'

export function SettingsAdvancedDatabase() {
  const handleExportDatabase = async () => {
    const path = `${RNFS.CachesDirectoryPath}/app.db`
    try {
      // VACUUM INTO refuses a target that already holds a database.
      if (await RNFS.exists(path)) await RNFS.unlink(path)
      await copyDatabaseTo(path)
      await Share.open({
        url: `file://${path}`,
        type: 'application/x-sqlite3',
        filename: 'app.db',
      })
      // The copy is left in the caches directory. On Android Share.open resolves
      // when the user picks an app, before that app has read the file.
    } catch (e: unknown) {
      if (e instanceof Error && e.message?.includes('User did not share')) return
      Alert.alert('Error', String(e))
    }
  }

  return (
    <InsetGroupSection header="Database">
      <InsetGroupLink
        label="Export database"
        description="Saves the app's SQLite database file for debugging."
        onPress={handleExportDatabase}
        showChevron={false}
      />
    </InsetGroupSection>
  )
}
