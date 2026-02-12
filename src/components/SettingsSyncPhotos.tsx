import { Linking, StyleSheet, Switch, Text } from 'react-native'
import { SYNC_ARCHIVE_RESUME_THRESHOLD } from '../config'
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
} from '../managers/syncPhotosArchive'
import { useFileStatsLocal } from '../stores/files'
import { colors } from '../styles/colors'
import { Button } from './Button'
import { RowGroup } from './Group'
import { InfoCard } from './InfoCard'
import { LabeledValueRow } from './LabeledValueRow'

export function SettingsSyncPhotos() {
  const autoSyncNew = useAutoSyncNewPhotos()
  const autoSyncPhotosArchive = useAutoSyncPhotosArchive()
  const photosArchiveCursor = usePhotosArchiveCursor()
  const localOnlyStats = useFileStatsLocal({ localOnly: true })
  const cursorValue = photosArchiveCursor.data ?? 0
  const photosArchiveInProgress = cursorValue > 0
  const { isSomeAccess, accessLabel, color } = useMediaLibraryPermissions()

  const isPhotosAccessDisabled = !isSomeAccess
  const archiveDateLabel = formatArchiveCursor(cursorValue)
  const syncPhotosArchiveControlsDisabled =
    isPhotosAccessDisabled || !autoSyncPhotosArchive.data

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
      {photosArchiveCursor.data && photosArchiveCursor.data > 0
        ? archiveDateLabel && (
            <Text
              style={[
                styles.info,
                syncPhotosArchiveControlsDisabled
                  ? styles.infoDisabled
                  : undefined,
              ]}
            >{`Currently synced back to: ${archiveDateLabel} ${
              !autoSyncPhotosArchive.data
                ? '(paused)'
                : photosArchiveInProgress
                  ? '(in progress)'
                  : ''
            }`}</Text>
          )
        : null}
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
        {photosArchiveCursor.data && photosArchiveCursor.data > 0
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

function formatArchiveCursor(value: number): string | null {
  // Always show a date; if value is not set or <= 0, use current time.
  const ts = Number.isFinite(value) && value > 0 ? value : Date.now()
  if (!Number.isFinite(ts)) return null
  const d = new Date(ts)
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
