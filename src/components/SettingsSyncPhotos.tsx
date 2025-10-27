import { Switch } from 'react-native'
import { InfoCard } from './InfoCard'
import { LabeledValueRow } from './LabeledValueRow'
import { Button } from './Button'
import { RowGroup } from './Group'
import {
  toggleAutoSyncNewPhotos,
  useAutoSyncNewPhotos,
} from '../managers/syncNewPhotos'
import {
  usePhotosArchiveCursor,
  restartPhotosArchiveCursor,
} from '../managers/syncPhotosArchive'

export function SettingsSyncPhotos() {
  const autoSyncNew = useAutoSyncNewPhotos()
  const photosArchiveCursor = usePhotosArchiveCursor()
  const photosArchiveInProgress = (photosArchiveCursor.data ?? 0) > 0

  return (
    <RowGroup title="Photos">
      <InfoCard>
        <LabeledValueRow
          label="Automatically import new photos"
          labelWidth={300}
          value={
            <Switch
              value={autoSyncNew.data ?? false}
              onValueChange={toggleAutoSyncNewPhotos}
            />
          }
        />
      </InfoCard>
      <Button
        style={{ marginTop: 10 }}
        disabled={photosArchiveInProgress}
        onPress={() => {
          void restartPhotosArchiveCursor()
        }}
      >
        {photosArchiveInProgress ? 'Sync in progress' : 'Import photos library'}
      </Button>
    </RowGroup>
  )
}
