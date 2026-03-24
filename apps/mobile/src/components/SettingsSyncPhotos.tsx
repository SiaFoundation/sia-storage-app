import { usePhotoImportDirectory } from '@siastorage/core/stores'
import { useCallback, useState } from 'react'
import { Linking, Pressable, StyleSheet, Switch, Text } from 'react-native'
import { useMediaLibraryPermissions } from '../lib/mediaLibraryPermissions'
import {
  toggleAutoSyncNewPhotos,
  useAutoSyncNewPhotos,
} from '../managers/syncNewPhotos'
import { useArchiveSyncCompletedAt } from '../managers/syncPhotosArchive'
import { app } from '../stores/appService'
import { openSheet } from '../stores/sheets'
import { colors } from '../styles/colors'
import { ArchiveSyncModal } from './ArchiveSyncModal'
import { Button } from './Button'
import { RowGroup } from './Group'
import { InfoCard } from './InfoCard'
import { LabeledValueRow } from './LabeledValueRow'
import { SelectDirectorySheet } from './SelectDirectorySheet'

export function SettingsSyncPhotos() {
  const autoSyncNew = useAutoSyncNewPhotos()
  const archiveCompletedAt = useArchiveSyncCompletedAt()
  const { isSomeAccess, accessLabel, color } = useMediaLibraryPermissions()
  const photoImportDir = usePhotoImportDirectory()
  const [modalVisible, setModalVisible] = useState(false)

  const completedDateLabel = formatDisplayDate(archiveCompletedAt.data ?? 0)

  const handleOpenDirectoryPicker = useCallback(() => {
    openSheet('selectPhotoImportDirectory')
  }, [])

  const handleSelectDirectory = useCallback((name: string) => {
    void app().settings.setPhotoImportDirectory(name)
  }, [])

  const handleClearDirectory = useCallback(() => {
    void app().settings.setPhotoImportDirectory('')
  }, [])

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
        <Pressable onPress={handleOpenDirectoryPicker}>
          <LabeledValueRow
            label="Import folder"
            labelWidth={250}
            value={photoImportDir.data || 'None'}
            canCopy={false}
          />
        </Pressable>
      </InfoCard>
      <SelectDirectorySheet
        sheetName="selectPhotoImportDirectory"
        currentValue={photoImportDir.data ?? ''}
        onSelect={handleSelectDirectory}
        onClear={handleClearDirectory}
      />
      <InfoCard style={{ marginTop: 10 }}>
        <LabeledValueRow
          label="Import new photos"
          labelWidth={250}
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
        disabled={!isSomeAccess}
        onPress={() => setModalVisible(true)}
      >
        Import photo library
      </Button>
      {completedDateLabel ? (
        <Text style={styles.info}>Last completed: {completedDateLabel}</Text>
      ) : null}
      <ArchiveSyncModal
        visible={modalVisible}
        onRequestClose={() => setModalVisible(false)}
      />
    </RowGroup>
  )
}

const styles = StyleSheet.create({
  link: {
    color: colors.accentPrimary,
  },
  info: {
    color: colors.textSecondary,
    marginTop: 10,
  },
})

function formatDisplayDate(displayDate: number): string | null {
  if (displayDate <= 0) return null
  const d = new Date(displayDate)
  if (Number.isNaN(d.getTime())) return null
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(d)
  } catch {
    return d.toDateString()
  }
}
