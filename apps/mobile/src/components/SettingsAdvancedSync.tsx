import { useAutoScanUploads, useAutoSyncDownEvents } from '@siastorage/core/stores'
import { Alert } from 'react-native'
import { app } from '../stores/appService'
import { toggleAutoScanUploads, toggleAutoSyncDownEvents } from '../stores/settings'
import { InsetGroupLink, InsetGroupSection, InsetGroupToggleRow } from './InsetGroup'

function confirmResetCursor(kind: 'down' | 'up') {
  const title = kind === 'down' ? 'Reset Sync Down Cursor' : 'Reset Sync Up Cursor'
  const message =
    kind === 'down'
      ? 'This will reset the sync down cursor and cause the app to resync all events from the beginning. Continue?'
      : 'This will reset the sync up cursor and cause the app to re-push metadata for all files. Continue?'
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    {
      text: 'Reset',
      style: 'destructive',
      onPress: () => {
        if (kind === 'down') {
          app().sync.setSyncDownCursor(undefined)
        } else {
          app().sync.setSyncUpCursor(undefined)
        }
      },
    },
  ])
}

export function SettingsAdvancedSync() {
  const autoScan = useAutoScanUploads()
  const autoSync = useAutoSyncDownEvents()

  return (
    <>
      <InsetGroupSection
        header="Sync"
        footer="Automatic sync keeps this device in step with your library on other devices."
      >
        <InsetGroupToggleRow
          label="Upload files to network"
          value={autoScan.data ?? false}
          onValueChange={toggleAutoScanUploads}
        />
        <InsetGroupToggleRow
          label="Sync with other devices"
          value={autoSync.data ?? false}
          onValueChange={toggleAutoSyncDownEvents}
        />
      </InsetGroupSection>
      <InsetGroupSection>
        <InsetGroupLink
          label="Reset sync down cursor"
          description="Re-downloads all events from the indexer. Can be slow on large libraries."
          destructive
          onPress={() => confirmResetCursor('down')}
          showChevron={false}
        />
        <InsetGroupLink
          label="Reset sync up cursor"
          description="Re-pushes local metadata to the indexer. Can be slow on large libraries."
          destructive
          onPress={() => confirmResetCursor('up')}
          showChevron={false}
        />
      </InsetGroupSection>
    </>
  )
}
