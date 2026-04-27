import { Alert } from 'react-native'
import Share from 'react-native-share'
import { database, getActiveJournalMode } from '../db'
import { toggleUseWalMode, useUseWalMode } from '../stores/settings'
import {
  InsetGroupLink,
  InsetGroupSection,
  InsetGroupToggleRow,
  InsetGroupValueRow,
} from './InsetGroup'

const ACTIVE_LABELS = {
  WAL: 'WAL',
  DELETE: 'Rollback journal',
} as const

export function SettingsAdvancedDatabase() {
  const useWal = useUseWalMode()
  const selected = useWal.data ?? false
  const active = getActiveJournalMode()
  const selectedMode = selected ? 'WAL' : 'DELETE'
  const restartRequired = selectedMode !== active

  const footer = restartRequired
    ? 'Restart the app to apply your change.'
    : 'WAL mode is exposed as a developer preference while we evaluate it. Toggling it off uses SQLite’s rollback journal.'

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
      <InsetGroupSection header="Database" footer={footer}>
        <InsetGroupToggleRow
          label="Use WAL journal mode"
          value={selected}
          onValueChange={toggleUseWalMode}
        />
        <InsetGroupValueRow label="Active mode" value={ACTIVE_LABELS[active]} />
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
