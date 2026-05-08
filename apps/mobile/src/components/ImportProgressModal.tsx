import { AlertCircleIcon, CheckCircle2Icon } from 'lucide-react-native'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { humanSize } from '../lib/humanSize'
import { dismissImportProgress, useImportProgress } from '../stores/importProgress'
import { colors, palette } from '../styles/colors'
import { ModalSheet } from './ModalSheet'
import { SpinnerIcon } from './SpinnerIcon'

const NOOP = () => {}

export function ImportProgressModal() {
  const { phase, totalFiles, copiedFiles, totalBytes, copiedBytes, errorMessage } =
    useImportProgress()

  const visible = phase === 'running' || phase === 'complete' || phase === 'error'
  const canClose = phase !== 'running'

  // Prefer bytes-based progress when source sizes are known; fall back
  // to file count when bytes are unavailable (e.g. share-extension files
  // sometimes lack a size). Math.min guards against measured size > stated size.
  const progress =
    totalBytes > 0
      ? Math.min(copiedBytes / totalBytes, 1)
      : totalFiles > 0
        ? Math.min(copiedFiles / totalFiles, 1)
        : 0

  const titleText =
    phase === 'running'
      ? 'Importing files'
      : phase === 'complete'
        ? 'Import complete'
        : phase === 'error'
          ? 'Import failed'
          : ''

  const line1Text =
    phase === 'running' || phase === 'complete'
      ? `${copiedFiles.toLocaleString()} of ${totalFiles.toLocaleString()} files`
      : ''

  const line2Text =
    (phase === 'running' || phase === 'complete') && totalBytes > 0
      ? `${humanSize(copiedBytes) ?? '0 B'} of ${humanSize(totalBytes) ?? '0 B'}`
      : ''

  const descriptionText =
    phase === 'running'
      ? 'Keep the app open until this finishes. Closing now may cancel the import.'
      : phase === 'complete'
        ? `${totalFiles.toLocaleString()} ${totalFiles === 1 ? 'file is' : 'files are'} now safely stored.`
        : phase === 'error'
          ? (errorMessage ?? 'Something went wrong while importing your files.')
          : ''

  return (
    <ModalSheet
      visible={visible}
      onRequestClose={canClose ? dismissImportProgress : NOOP}
      title="Import"
      headerRight={
        canClose ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Done"
            onPress={dismissImportProgress}
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
              <CheckCircle2Icon color={palette.green[500]} size={48} strokeWidth={1.5} />
            ) : phase === 'error' ? (
              <AlertCircleIcon color={palette.red[500]} size={48} strokeWidth={1.5} />
            ) : null}
          </View>
          <View style={styles.titleRow}>
            <Text style={styles.titleText}>{titleText}</Text>
          </View>
          <View style={styles.lineRow}>
            <Text style={styles.lineText}>{line1Text}</Text>
          </View>
          <View style={styles.lineRow}>
            <Text style={styles.lineText}>{line2Text}</Text>
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
            <Text style={styles.descriptionText}>{descriptionText}</Text>
          </View>
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
  invisible: {
    opacity: 0,
  },
})
