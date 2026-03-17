import { SYNC_ARCHIVE_RESUME_THRESHOLD } from '@siastorage/core/config'
import { usePhotoImportDirectory } from '@siastorage/core/stores'
import { useCallback } from 'react'
import { Linking, Pressable, StyleSheet, Switch, Text } from 'react-native'
import { humanSize } from '../lib/humanSize'
import { useMediaLibraryPermissions } from '../lib/mediaLibraryPermissions'
import {
  toggleAutoSyncNewPhotos,
  useAutoSyncNewPhotos,
} from '../managers/syncNewPhotos'
import {
  restartPhotosArchiveCursor,
  toggleAutoSyncPhotosArchive,
  useAutoSyncPhotosArchive,
  usePhotosArchiveCursor,
  usePhotosArchiveDisplayDate,
} from '../managers/syncPhotosArchive'
import { app } from '../stores/appService'
import { useFileStatsLocal } from '../stores/files'
import { openSheet } from '../stores/sheets'
import { colors } from '../styles/colors'
import { Button } from './Button'
import { RowGroup } from './Group'
import { InfoCard } from './InfoCard'
import { LabeledValueRow } from './LabeledValueRow'
import { SelectDirectorySheet } from './SelectDirectorySheet'

export function SettingsSyncPhotos() {
  const autoSyncNew = useAutoSyncNewPhotos()
  const autoSyncPhotosArchive = useAutoSyncPhotosArchive()
  const photosArchiveCursor = usePhotosArchiveCursor()
  const photosArchiveDisplayDate = usePhotosArchiveDisplayDate()
  const localOnlyStats = useFileStatsLocal({ localOnly: true })
  const cursorValue = photosArchiveCursor.data ?? 'done'
  const photosArchiveInProgress = cursorValue !== 'done'
  const { isSomeAccess, accessLabel, color } = useMediaLibraryPermissions()
  const photoImportDir = usePhotoImportDirectory()

  const isPhotosAccessDisabled = !isSomeAccess
  const archiveDateLabel = formatDisplayDate(photosArchiveDisplayDate.data ?? 0)
  const syncPhotosArchiveControlsDisabled =
    isPhotosAccessDisabled || !autoSyncPhotosArchive.data

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
      <InfoCard style={{ marginTop: 10 }}>
        <LabeledValueRow
          label="Import archive"
          labelWidth={250}
          value={
            <Switch
              value={autoSyncPhotosArchive.data ?? false}
              onValueChange={toggleAutoSyncPhotosArchive}
            />
          }
        />
      </InfoCard>
      {photosArchiveInProgress ? (
        <Text
          style={[
            styles.info,
            syncPhotosArchiveControlsDisabled ? styles.infoDisabled : undefined,
          ]}
        >
          {archiveDateLabel
            ? `Currently synced back to: ${archiveDateLabel} ${
                !autoSyncPhotosArchive.data ? '(paused)' : '(in progress)'
              }`
            : `Archive sync ${
                !autoSyncPhotosArchive.data ? '(paused)' : '(in progress)'
              }`}
        </Text>
      ) : null}
      {autoSyncPhotosArchive.data &&
      photosArchiveInProgress &&
      (localOnlyStats.data?.totalBytes ?? 0) >=
        SYNC_ARCHIVE_RESUME_THRESHOLD ? (
        <Text
          style={styles.info}
        >{`Waiting for ${humanSize(localOnlyStats.data?.totalBytes ?? 0) ?? '0 B'} to upload before continuing archive sync`}</Text>
      ) : null}
      <Button
        style={{ marginTop: 10 }}
        disabled={syncPhotosArchiveControlsDisabled}
        onPress={() => {
          void restartPhotosArchiveCursor()
        }}
      >
        {photosArchiveInProgress
          ? 'Restart archive sync'
          : 'Start archive sync'}
      </Button>
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
  infoDisabled: {
    color: colors.textMuted,
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
