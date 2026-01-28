import { Alert, Switch } from 'react-native'
import { resetSyncDownCursor } from '../managers/syncDownEvents'
import {
  toggleAutoScanUploads,
  toggleAutoSyncDownEvents,
  useAutoScanUploads,
  useAutoSyncDownEvents,
} from '../stores/settings'
import { Button } from './Button'
import { RowGroup } from './Group'
import { InfoCard } from './InfoCard'
import { LabeledValueRow } from './LabeledValueRow'

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
                  ],
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
