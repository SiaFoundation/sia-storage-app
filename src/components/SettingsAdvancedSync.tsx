import { Switch } from 'react-native'
import { InfoCard } from './InfoCard'
import { LabeledValueRow } from './LabeledValueRow'
import { RowGroup } from './Group'
import {
  toggleAutoScanUploads,
  toggleAutoSyncDownEvents,
  useAutoScanUploads,
  useAutoSyncDownEvents,
} from '../stores/settings'

export function SettingsAdvancedSync() {
  const autoScan = useAutoScanUploads()
  const autoSync = useAutoSyncDownEvents()

  return (
    <RowGroup title="Advanced Sync">
      <InfoCard>
        <LabeledValueRow
          label="Automatically upload files to network"
          labelWidth={300}
          value={
            <Switch
              value={autoScan.data ?? false}
              onValueChange={toggleAutoScanUploads}
            />
          }
        />
        <LabeledValueRow
          label="Automatically sync with your other devices"
          labelWidth={300}
          value={
            <Switch
              value={autoSync.data ?? false}
              onValueChange={toggleAutoSyncDownEvents}
            />
          }
        />
      </InfoCard>
    </RowGroup>
  )
}
