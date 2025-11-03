import { Linking, StyleSheet, Switch } from 'react-native'
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
import { useMediaLibraryPermissions } from '../lib/mediaLibraryPermissions'
import { Text } from 'react-native'
import { colors } from '../styles/colors'

export function SettingsSyncPhotos() {
  const autoSyncNew = useAutoSyncNewPhotos()
  const photosArchiveCursor = usePhotosArchiveCursor()
  const photosArchiveInProgress = (photosArchiveCursor.data ?? 0) > 0
  const { isSomeAccess, accessLabel, color } = useMediaLibraryPermissions()

  const isDisabled = !isSomeAccess

  return (
    <RowGroup
      title="Photos"
      indicator={
        <Text
          accessibilityRole="link"
          onPress={() => {
            Linking.openSettings().catch(() => {})
          }}
          style={[styles.link, { color }]}
        >
          {accessLabel}
        </Text>
      }
    >
      <InfoCard>
        <LabeledValueRow
          label="Import new photos"
          labelWidth={250}
          value={
            <Switch
              disabled={isDisabled}
              value={autoSyncNew.data ?? false}
              onValueChange={toggleAutoSyncNewPhotos}
            />
          }
        />
      </InfoCard>
      <Button
        style={{ marginTop: 10 }}
        disabled={photosArchiveInProgress || isDisabled}
        onPress={() => {
          void restartPhotosArchiveCursor()
        }}
      >
        {photosArchiveInProgress ? 'Sync in progress' : 'Import photos library'}
      </Button>
    </RowGroup>
  )
}

const styles = StyleSheet.create({
  link: {
    color: colors.accentPrimary,
  },
})
