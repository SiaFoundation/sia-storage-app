import { Switch, Alert } from 'react-native'
import { InfoCard } from './InfoCard'
import { LabeledValueRow } from './LabeledValueRow'
import { RowGroup } from './Group'
import { Button } from './Button'
import {
  toggleAutoScanUploads,
  toggleAutoSyncDownEvents,
  useAutoScanUploads,
  useAutoSyncDownEvents,
} from '../stores/settings'
import { resetSyncDownCursor } from '../managers/syncDownEvents'

export function SettingsAdvancedSync() {
  const autoScan = useAutoScanUploads()
  const autoSync = useAutoSyncDownEvents()

  return (
    <RowGroup title="Advanced Sync">
      <InfoCard>
        <LabeledValueRow
          label="Upload files to network"
          labelWidth={250}
          value={
            <Switch
              value={autoScan.data ?? false}
              onValueChange={toggleAutoScanUploads}
            />
          }
        />
        <LabeledValueRow
          label="Sync with other devices"
          labelWidth={250}
          value={
            <Switch
              value={autoSync.data ?? false}
              onValueChange={toggleAutoSyncDownEvents}
            />
          }
        />
        <LabeledValueRow
          label="Reset sync cursor"
          labelWidth={250}
          value={
            <Button
              variant="secondary"
              style={{ paddingVertical: 8, paddingHorizontal: 16 }}
              onPress={() => {
                Alert.alert(
                  'Reset Sync Cursor',
                  'This will reset the sync cursor and cause the app to resync all events from the beginning. Continue?',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Reset',
                      style: 'destructive',
                      onPress: () => resetSyncDownCursor(),
                    },
                  ]
                )
              }}
            >
              Reset
            </Button>
          }
        />
      </InfoCard>
    </RowGroup>
  )
}
