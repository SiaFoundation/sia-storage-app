import * as MediaLibrary from 'expo-media-library'
import { CloudUploadIcon, ImageIcon } from 'lucide-react-native'
import { useCallback, useEffect, useReducer } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import {
  getArchiveImportId,
  startArchiveSync,
  stopArchiveSync,
  usePhotosArchiveCursor,
  usePhotosArchiveDisplayDate,
  usePhotosExistingCount,
  usePhotosScannedCount,
} from '../managers/syncPhotosArchive'
import { navigateToImportDetail } from '../lib/navigationRef'
import { colors, palette } from '../styles/colors'
import { Button } from './Button'
import { ModalSheet } from './ModalSheet'
import { SpinnerIcon } from './SpinnerIcon'

type LibraryStats = {
  totalCount: number
  oldestDate: number
  newestDate: number
}

async function fetchLibraryStats(): Promise<LibraryStats | null> {
  try {
    const mediaTypes = [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video]
    const oldest = await MediaLibrary.getAssetsAsync({
      first: 1,
      sortBy: [[MediaLibrary.SortBy.modificationTime, true]],
      mediaType: mediaTypes,
    })
    if (oldest.totalCount === 0) return null
    const newest = await MediaLibrary.getAssetsAsync({
      first: 1,
      sortBy: [[MediaLibrary.SortBy.modificationTime, false]],
      mediaType: mediaTypes,
    })
    return {
      totalCount: oldest.totalCount,
      oldestDate: oldest.assets[0]?.modificationTime ?? 0,
      newestDate: newest.assets[0]?.modificationTime ?? 0,
    }
  } catch {
    return null
  }
}

type Phase = 'loading' | 'preview' | 'running' | 'complete'

type State = {
  phase: Phase
  stats: LibraryStats | null
}

type Action =
  | { type: 'open' }
  | { type: 'close' }
  | { type: 'stats_loaded'; stats: LibraryStats | null }
  | { type: 'start' }
  | { type: 'done' }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'open':
      return { phase: 'loading', stats: null }
    case 'close':
      return { phase: 'loading', stats: null }
    case 'stats_loaded':
      return { ...state, phase: 'preview', stats: action.stats }
    case 'start':
      return state.phase === 'preview' ? { ...state, phase: 'running' } : state
    case 'done':
      return state.phase === 'running' ? { ...state, phase: 'complete' } : state
  }
}

type Props = {
  visible: boolean
  onRequestClose: () => void
}

export function ArchiveSyncModal({ visible, onRequestClose }: Props) {
  const photosArchiveCursor = usePhotosArchiveCursor()
  const photosArchiveDisplayDate = usePhotosArchiveDisplayDate()
  const photosScannedCount = usePhotosScannedCount()
  const photosExistingCount = usePhotosExistingCount()
  const cursorValue = photosArchiveCursor.data ?? 'done'
  const displayDate = photosArchiveDisplayDate.data ?? 0
  const scannedCount = photosScannedCount.data ?? 0
  const existingCount = photosExistingCount.data ?? 0
  // Survivors actually staged into the import = walked minus identity-dedup skips.
  const newCount = scannedCount - existingCount

  const [{ phase, stats }, dispatch] = useReducer(reducer, {
    phase: 'loading',
    stats: null,
  })

  useEffect(() => {
    if (visible) {
      dispatch({ type: 'open' })
      fetchLibraryStats().then((s) => dispatch({ type: 'stats_loaded', stats: s }))
    } else {
      dispatch({ type: 'close' })
    }
  }, [visible])

  useEffect(() => {
    if (cursorValue === 'done') {
      dispatch({ type: 'done' })
    }
  }, [cursorValue])

  const handleStart = useCallback(() => {
    dispatch({ type: 'start' })
    void startArchiveSync()
  }, [])

  const handleViewImport = useCallback(() => {
    const importId = getArchiveImportId()
    onRequestClose()
    if (importId) navigateToImportDetail(importId)
  }, [onRequestClose])

  const progress =
    phase === 'running' && stats && stats.totalCount > 0
      ? Math.min(scannedCount / stats.totalCount, 1)
      : 0

  const canClose = phase !== 'running'
  const showContent = phase !== 'loading'

  const titleText =
    phase === 'preview'
      ? stats
        ? `${stats.totalCount.toLocaleString()} photos and videos`
        : 'No photos or videos found'
      : phase === 'running'
        ? displayDate > 0
          ? `Scanning: ${formatDisplayDate(displayDate)}`
          : 'Starting import...'
        : phase === 'complete'
          ? 'Import started'
          : ''

  // During the scan the lines show walk progress; on completion they report what
  // the import actually took on: photos staged, and how many were skipped because
  // they were already imported.
  const line1Text =
    phase === 'preview' && stats
      ? `${formatDisplayDate(stats.oldestDate)} — ${formatDisplayDate(stats.newestDate)}`
      : phase === 'running' && scannedCount > 0
        ? `${scannedCount.toLocaleString()}${stats ? ` of ${stats.totalCount.toLocaleString()}` : ''} scanned`
        : phase === 'complete'
          ? `${newCount.toLocaleString()} ${newCount === 1 ? 'photo' : 'photos'} added`
          : ''

  const line2Text =
    phase === 'running' && scannedCount > 0
      ? `${newCount.toLocaleString()} added${existingCount > 0 ? ` · ${existingCount.toLocaleString()} already imported` : ''}`
      : phase === 'complete' && existingCount > 0
        ? `${existingCount.toLocaleString()} already imported`
        : ''

  return (
    <ModalSheet
      visible={visible}
      onRequestClose={canClose ? onRequestClose : () => {}}
      title="Import Photo Library"
      headerRight={
        canClose ? (
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
      <View style={styles.root}>
        <View style={styles.slots}>
          <View style={styles.iconRow}>
            {phase === 'running' ? (
              <SpinnerIcon color={palette.blue[400]} size={48} />
            ) : phase === 'complete' ? (
              <CloudUploadIcon color={palette.blue[400]} size={48} strokeWidth={1.5} />
            ) : (
              <ImageIcon color={palette.gray[400]} size={48} strokeWidth={1.5} />
            )}
          </View>
          <View style={styles.titleRow}>
            <Text style={styles.titleText}>{showContent ? titleText : ''}</Text>
          </View>
          <View style={styles.lineRow}>
            <Text style={styles.lineText}>{showContent ? line1Text : ''}</Text>
          </View>
          <View style={styles.lineRow}>
            <Text style={styles.lineText}>{showContent ? line2Text : ''}</Text>
          </View>
          <View style={styles.progressRow}>
            <View style={[styles.progressTrack, phase !== 'running' && styles.invisible]}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${(progress * 100).toFixed(1)}%` as `${number}%`,
                  },
                ]}
              />
            </View>
          </View>
          <View style={styles.descriptionRow}>
            <Text
              style={[
                styles.descriptionText,
                (phase === 'running' || phase === 'loading') && styles.invisible,
              ]}
            >
              {phase === 'complete'
                ? 'Your photo library was added to an import. The system will gradually import and upload these files.'
                : 'Your whole photo library is added to an import, then copied and uploaded in the background over time.'}
            </Text>
          </View>
        </View>
        <View style={styles.actionRow}>
          {phase === 'complete' ? (
            <Button variant="primary" onPress={handleViewImport}>
              View import
            </Button>
          ) : (
            <View style={phase !== 'preview' && phase !== 'running' ? styles.invisible : undefined}>
              <Button
                variant={phase === 'running' ? 'secondary' : 'primary'}
                onPress={
                  phase === 'running'
                    ? () => {
                        void stopArchiveSync()
                      }
                    : handleStart
                }
                disabled={phase === 'preview' && (!stats || stats.totalCount === 0)}
              >
                {phase === 'running' ? 'Stop import' : 'Start import'}
              </Button>
            </View>
          )}
        </View>
      </View>
    </ModalSheet>
  )
}

const ICON_SIZE = 48
const TITLE_HEIGHT = 24
const LINE_HEIGHT = 20
const PROGRESS_HEIGHT = 4
const DESCRIPTION_MIN_HEIGHT = 80

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingHorizontal: 24,
  },
  slots: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconRow: {
    height: ICON_SIZE,
    marginBottom: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  titleRow: {
    height: TITLE_HEIGHT,
    marginBottom: 8,
    justifyContent: 'center',
  },
  lineRow: {
    height: LINE_HEIGHT,
    marginBottom: 4,
    justifyContent: 'center',
  },
  progressRow: {
    height: PROGRESS_HEIGHT,
    width: '60%',
    marginTop: 16,
    marginBottom: 20,
  },
  descriptionRow: {
    minHeight: DESCRIPTION_MIN_HEIGHT,
  },
  titleText: {
    color: colors.textPrimary,
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
  },
  lineText: {
    color: colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
  },
  descriptionText: {
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
  progressTrack: {
    height: PROGRESS_HEIGHT,
    borderRadius: 2,
    backgroundColor: palette.gray[800],
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: palette.blue[400],
  },
  actionRow: {
    height: 100,
    justifyContent: 'flex-start',
    paddingTop: 8,
  },
  invisible: {
    opacity: 0,
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
