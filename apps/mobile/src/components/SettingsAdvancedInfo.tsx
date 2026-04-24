import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { useShowAdvanced } from '@siastorage/core/stores'
import { Alert } from 'react-native'
import Share from 'react-native-share'
import { database } from '../db'
import { humanSize } from '../lib/humanSize'
import { runFsEvictionScanner } from '../managers/fsEvictionScanner'
import { runFsOrphanScanner } from '../managers/fsOrphanScanner'
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

  const handleClearLocalFiles = async () => {
    const cached = await app().fs.calcTotalSize()
    Alert.alert(
      'Clear local files',
      `Removes up to ${humanSize(cached) ?? '0 B'} of files from this device. Files that aren't backed up yet are kept.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            try {
              const before = await app().fs.calcTotalSize()
              await runFsOrphanScanner({ force: true })
              await runFsEvictionScanner({ force: true })
              const after = await app().fs.calcTotalSize()
              const freed = Math.max(0, before - after)
              Alert.alert('Local files cleared', `Freed ${humanSize(freed) ?? '0 B'}.`)
            } catch (e: unknown) {
              Alert.alert('Error', String(e))
            }
          },
        },
      ],
    )
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
        <InsetGroupLink
          label="Clear local files"
          description="Removes files on this device that are already backed up. Files that aren't backed up yet are kept."
          onPress={handleClearLocalFiles}
          showChevron={false}
          destructive
        />
      </InsetGroupSection>
    </>
  )
}
