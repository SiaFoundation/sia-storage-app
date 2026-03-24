import { CheckCircle2Icon } from 'lucide-react-native'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import {
  startArchiveSync,
  stopArchiveSync,
  usePhotosAddedCount,
  usePhotosArchiveCursor,
  usePhotosArchiveDisplayDate,
} from '../managers/syncPhotosArchive'
import { colors, palette } from '../styles/colors'
import { Button } from './Button'
import { ModalSheet } from './ModalSheet'

type Props = {
  visible: boolean
  onRequestClose: () => void
}

export function ArchiveSyncModal({ visible, onRequestClose }: Props) {
  const photosArchiveCursor = usePhotosArchiveCursor()
  const photosArchiveDisplayDate = usePhotosArchiveDisplayDate()
  const photosAddedCount = usePhotosAddedCount()
  const cursorValue = photosArchiveCursor.data ?? 'done'
  const isDone = cursorValue === 'done'
  const displayDate = photosArchiveDisplayDate.data ?? 0
  const addedCount = photosAddedCount.data ?? 0
  const [started, setStarted] = useState(false)

  const startedRef = useRef(false)
  const handleShow = useCallback(() => {
    if (startedRef.current) return
    startedRef.current = true
    setStarted(true)
    void startArchiveSync()
  }, [])

  useEffect(() => {
    if (!visible) {
      startedRef.current = false
      setStarted(false)
    }
  }, [visible])

  const isRunning = started && !isDone
  const isComplete = isDone && started

  return (
    <ModalSheet
      visible={visible}
      onRequestClose={isComplete ? onRequestClose : () => {}}
      onShow={handleShow}
      title="Import Photo Library"
      headerRight={
        isComplete ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Done"
            onPress={onRequestClose}
            hitSlop={8}
          >
            <Text style={styles.doneText}>Done</Text>
          </Pressable>
        ) : (
          <View />
        )
      }
    >
      <View style={styles.content}>
        {isRunning ? (
          <View style={styles.statusContainer}>
            <ActivityIndicator color={palette.blue[400]} size="large" />
            <Text style={styles.statusText}>
              {displayDate > 0
                ? `Scanning: ${formatDisplayDate(displayDate)}`
                : 'Starting import...'}
            </Text>
            {addedCount > 0 ? (
              <Text style={styles.countText}>
                {addedCount.toLocaleString()} photos scanned
              </Text>
            ) : null}
          </View>
        ) : isComplete ? (
          <View style={styles.statusContainer}>
            <CheckCircle2Icon color={palette.green[500]} size={40} />
            <Text style={styles.statusText}>Import complete</Text>
            {addedCount > 0 ? (
              <Text style={styles.countText}>
                {addedCount.toLocaleString()} photos added
              </Text>
            ) : null}
          </View>
        ) : null}
        <Text style={styles.description}>
          Your photo library will be imported into Sia. Photos are added to your
          library immediately and are then processed and uploaded gradually in
          the background.
        </Text>
        {isRunning ? (
          <Button
            variant="secondary"
            onPress={() => {
              void stopArchiveSync()
            }}
          >
            Stop import
          </Button>
        ) : null}
      </View>
    </ModalSheet>
  )
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 40,
    alignItems: 'center',
    gap: 32,
  },
  statusContainer: {
    alignItems: 'center',
    gap: 16,
  },
  statusText: {
    color: colors.textPrimary,
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
  },
  countText: {
    color: colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
  },
  description: {
    color: colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 300,
  },
  doneText: {
    color: palette.blue[400],
    fontSize: 17,
    fontWeight: '600',
  },
})

function formatDisplayDate(displayDate: number): string {
  const d = new Date(displayDate)
  if (Number.isNaN(d.getTime())) return ''
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
