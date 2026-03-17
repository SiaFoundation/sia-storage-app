import {
  useAutoScanUploads,
  useAutoSyncDownEvents,
} from '@siastorage/core/stores'
import { Alert, Switch } from 'react-native'
import { app } from '../stores/appService'
import {
  toggleAutoScanUploads,
  toggleAutoSyncDownEvents,
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
          label="Reset sync down cursor"
          labelWidth={250}
          value={
            <Button
              variant="secondary"
              style={{ paddingVertical: 8, paddingHorizontal: 16 }}
              onPress={() => {
                Alert.alert(
                  'Reset Sync Down Cursor',
                  'This will reset the sync down cursor and cause the app to resync all events from the beginning. Continue?',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Reset',
                      style: 'destructive',
                      onPress: () => app().sync.setSyncDownCursor(undefined),
                    },
                  ],
                )
              }}
            >
              Reset
            </Button>
          }
        />
        <LabeledValueRow
          label="Reset sync up cursor"
          labelWidth={250}
          value={
            <Button
              variant="secondary"
              style={{ paddingVertical: 8, paddingHorizontal: 16 }}
              onPress={() => {
                Alert.alert(
                  'Reset Sync Up Cursor',
                  'This will reset the sync up cursor and cause the app to re-push metadata for all files. Continue?',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Reset',
                      style: 'destructive',
                      onPress: () => app().sync.setSyncUpCursor(undefined),
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
