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
  usePhotosArchivePaused,
  pausePhotosArchive,
  resumePhotosArchive,
  resetPhotosArchiveCursor,
} from '../managers/syncPhotosArchive'
import { useMediaLibraryPermissions } from '../lib/mediaLibraryPermissions'
import { Text } from 'react-native'
import { colors } from '../styles/colors'

export function SettingsSyncPhotos() {
  const autoSyncNew = useAutoSyncNewPhotos()
  const photosArchiveCursor = usePhotosArchiveCursor()
  const photosArchivePaused = usePhotosArchivePaused()
  const cursorValue = photosArchiveCursor.data ?? 0
  const photosArchiveInProgress = cursorValue > 0
  const { isSomeAccess, accessLabel, color } = useMediaLibraryPermissions()

  const isDisabled = !isSomeAccess
  const archiveDateLabel = formatArchiveCursor(cursorValue)
  // Enabled means the feature is on, regardless of paused state.
  const archiveEnabled =
    photosArchiveInProgress || (photosArchivePaused.data ?? false)
  const controlsDisabled = isDisabled || !archiveEnabled

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
      <InfoCard style={{ marginTop: 10 }}>
        <LabeledValueRow
          label="Import archive"
          labelWidth={250}
          value={
            <Switch
              disabled={isDisabled}
              value={archiveEnabled}
              onValueChange={(val) => {
                if (val) {
                  // Turning ON: ensure not paused and start/restart.
                  void resumePhotosArchive()
                  void restartPhotosArchiveCursor()
                } else {
                  // Turning OFF: disable cursor and clear paused state.
                  void resetPhotosArchiveCursor()
                  void resumePhotosArchive()
                }
              }}
            />
          }
        />
      </InfoCard>
      {archiveDateLabel && (
        <Text
          style={[
            styles.info,
            controlsDisabled ? styles.infoDisabled : undefined,
          ]}
        >{`Currently synced back to: ${archiveDateLabel} ${
          !archiveEnabled
            ? '(off)'
            : photosArchivePaused.data
            ? '(paused)'
            : photosArchiveInProgress
            ? '(in progress)'
            : ''
        }`}</Text>
      )}
      <Button
        style={{ marginTop: 10 }}
        disabled={controlsDisabled}
        onPress={() => {
          const paused = photosArchivePaused.data ?? false
          void (paused ? resumePhotosArchive() : pausePhotosArchive())
        }}
      >
        {photosArchivePaused.data ?? false
          ? 'Resume archive sync'
          : 'Pause archive sync'}
      </Button>
      <Button
        style={{ marginTop: 10 }}
        disabled={controlsDisabled}
        onPress={() => {
          void restartPhotosArchiveCursor()
        }}
      >
        Reset archive sync
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
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ] as const
  const month = months[d.getMonth()] ?? ''
  const day = d.getDate()
  const year = d.getFullYear()
  const suffix = getOrdinalSuffix(day)
  return `${month} ${day}${suffix}, ${year}`
}

function getOrdinalSuffix(day: number): string {
  const mod10 = day % 10
  const mod100 = day % 100
  if (mod100 >= 11 && mod100 <= 13) return 'th'
  if (mod10 === 1) return 'st'
  if (mod10 === 2) return 'nd'
  if (mod10 === 3) return 'rd'
  return 'th'
}
