import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { useShowAdvanced } from '@siastorage/core/stores'
import { Alert } from 'react-native'
import Share from 'react-native-share'
import { database } from '../db'
import type { MenuStackParamList } from '../stacks/types'
import { app } from '../stores/appService'
import { InsetGroupLink, InsetGroupSection, InsetGroupToggleRow } from './InsetGroup'

type Props = NativeStackScreenProps<MenuStackParamList, 'Advanced'>

export function SettingsAdvancedInfo(_props: Props) {
  const showAdvanced = useShowAdvanced()

  const handleExportDatabase = async () => {
    try {
      await Share.open({
        url: `file://${database.databasePath}`,
        type: 'application/x-sqlite3',
        filename: 'app.db',
      })
    } catch (e: unknown) {
      if (e instanceof Error && e.message?.includes('User did not share')) return
      Alert.alert('Error', String(e))
    }
  }

  return (
    <>
      <InsetGroupSection
        header="Debugging"
        footer="Shows extra technical details like file IDs, hashes, and URIs on file info screens."
      >
        <InsetGroupToggleRow
          label="Show advanced information"
          value={showAdvanced.data ?? false}
          onValueChange={(val) => app().settings.setShowAdvanced(val)}
        />
      </InsetGroupSection>
      <InsetGroupSection>
        <InsetGroupLink
          label="Export database"
          description="Saves the app's SQLite database file for debugging."
          onPress={handleExportDatabase}
          showChevron={false}
        />
      </InsetGroupSection>
    </>
  )
}
