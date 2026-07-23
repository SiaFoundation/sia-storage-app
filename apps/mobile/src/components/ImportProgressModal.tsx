import type { ImportFileRow } from '@siastorage/core/db/operations'
import { useEffect } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useNow } from '../hooks/useNow'
import {
  reasonCopy,
  progressBytesLabel,
  progressRatio,
  sourceLabel,
  statusColor,
  statusLabel,
} from '../lib/importLabels'
import { navigateToImportDetail } from '../lib/navigationRef'
import { useMonotonicRatio } from '../hooks/useMonotonicRatio'
import { dismissImportProgress, useImportProgress } from '../stores/importProgress'
import {
  useImport,
  useImportDestinationName,
  useImportFiles,
  useImportSummary,
} from '../stores/imports'
import { colors, palette } from '../styles/colors'
import { ImportCountChips } from './ImportCountChips'
import { ImportFileStateBadge } from './ImportFileStateBadge'
import { ImportProgressBar } from './ImportProgressBar'
import { ModalSheet } from './ModalSheet'
import { SpinnerIcon } from './SpinnerIcon'

// How many per-file rows the modal previews. The full list lives on the Imports
// detail screen; the modal stays lightweight (a 50k library-scan must not load
// 50k rows here).
const PREVIEW_LIMIT = 6

export function ImportProgressModal() {
  const { importId, revealed } = useImportProgress()
  return importId ? (
    <ImportProgressModalContent key={importId} importId={importId} revealed={revealed} />
  ) : null
}

function ImportProgressModalContent({
  importId,
  revealed,
}: {
  importId: string
  revealed: boolean
}) {
  const { data: imp } = useImport(importId)
  const { data: summaries } = useImportSummary([importId])
  const { data: files } = useImportFiles(importId, { limit: PREVIEW_LIMIT })
  const destinationName = useImportDestinationName(imp?.directoryId)

  const summary = summaries?.[0]
  const status = summary?.status ?? 'queued'
  const done = status === 'done'
  const now = useNow()

  // A done that lands before the reveal delay dismisses at once, so the modal
  // never appears for a fast import. Once revealed, hold so the completed state
  // is actually seen. The full record stays in the Imports list.
  useEffect(() => {
    if (!done) return
    if (!revealed) {
      dismissImportProgress()
      return
    }
    const timer = setTimeout(dismissImportProgress, 1200)
    return () => clearTimeout(timer)
  }, [done, revealed])

  // Hold hidden until the reveal delay elapses, so a fast import never flashes.
  const visible = revealed && !!summary

  const ratio = useMonotonicRatio(!done, imp && summary ? progressRatio(imp, summary) : 0)
  const byteLine = summary ? (progressBytesLabel(summary) ?? '') : ''

  const handleViewAll = () => {
    dismissImportProgress()
    navigateToImportDetail(importId)
  }

  return (
    <ModalSheet
      visible={visible}
      onRequestClose={dismissImportProgress}
      title="Import"
      headerRight={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Done"
          onPress={dismissImportProgress}
          hitSlop={8}
        >
          <Text style={styles.doneText}>Done</Text>
        </Pressable>
      }
    >
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.headerRow}>
          <View style={styles.headerText}>
            <Text style={styles.source}>{imp ? sourceLabel(imp.source) : 'Import'}</Text>
            <Text style={styles.destination} numberOfLines={1}>
              {destinationName}
            </Text>
          </View>
          {summary ? (
            <View style={styles.statusBadge}>
              {!done ? <SpinnerIcon color={palette.blue[400]} size={14} /> : null}
              <Text style={[styles.statusText, { color: statusColor(summary) }]}>
                {statusLabel(status)}
              </Text>
            </View>
          ) : null}
        </View>

        {!done ? (
          <View style={styles.progressBlock}>
            <ImportProgressBar ratio={ratio} />
            {byteLine ? <Text style={styles.byteLine}>{byteLine}</Text> : null}
          </View>
        ) : null}

        {summary ? <ImportCountChips summary={summary} /> : null}

        {files && files.length > 0 ? (
          <View style={styles.fileList}>
            {files.map((file: ImportFileRow) => (
              <View key={file.id} style={styles.fileRow}>
                <View style={styles.fileText}>
                  <Text style={styles.fileName} numberOfLines={1}>
                    {file.name}
                  </Text>
                  {reasonCopy(file.reason) && file.state !== 'added' ? (
                    <Text style={styles.fileReason} numberOfLines={1}>
                      {reasonCopy(file.reason)}
                    </Text>
                  ) : null}
                </View>
                <ImportFileStateBadge row={file} now={now} />
              </View>
            ))}
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          onPress={handleViewAll}
          style={({ pressed }) => [styles.viewAll, pressed ? styles.viewAllPressed : null]}
        >
          <Text style={styles.viewAllText}>View import details</Text>
        </Pressable>
      </ScrollView>
    </ModalSheet>
  )
}

const styles = StyleSheet.create({
  scroll: {
    padding: 24,
    gap: 20,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerText: {
    flex: 1,
    flexShrink: 1,
  },
  source: {
    color: colors.textPrimary,
    fontSize: 17,
    fontWeight: '600',
  },
  destination: {
    color: colors.textSecondary,
    fontSize: 14,
    marginTop: 2,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusText: {
    fontSize: 13,
    fontWeight: '600',
  },
  progressBlock: {
    gap: 8,
  },
  byteLine: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  fileList: {
    gap: 12,
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  fileText: {
    flex: 1,
    flexShrink: 1,
  },
  fileName: {
    color: palette.gray[100],
    fontSize: 15,
  },
  fileReason: {
    color: palette.gray[400],
    fontSize: 13,
    marginTop: 2,
  },
  viewAll: {
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 10,
    backgroundColor: colors.bgPanel,
  },
  viewAllPressed: {
    backgroundColor: palette.gray[800],
  },
  viewAllText: {
    color: palette.blue[400],
    fontSize: 16,
    fontWeight: '600',
  },
  doneText: {
    color: palette.blue[400],
    fontSize: 17,
    fontWeight: '600',
  },
})
