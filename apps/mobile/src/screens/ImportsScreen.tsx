import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import type { ImportRow, ImportSummary } from '@siastorage/core/db/operations'
import { useMemo } from 'react'
import { FolderIcon } from 'lucide-react-native'
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import { ImportProgressBar } from '../components/ImportProgressBar'
import { SpinnerIcon } from '../components/SpinnerIcon'
import { useMonotonicRatio } from '../hooks/useMonotonicRatio'
import { useNow } from '../hooks/useNow'
import {
  progressBytesLabel,
  progressCountLabel,
  progressRatio,
  sourceLabel,
  summaryLine,
} from '../lib/importLabels'
import { relativeTimeLabel } from '../lib/relativeTime'
import type { ImportsStackParamList } from '../stacks/types'
import { useImportDestinationName, useImports, useImportSummary } from '../stores/imports'
import { colors, palette } from '../styles/colors'

type Props = NativeStackScreenProps<ImportsStackParamList, 'Imports'>

export function ImportsScreen({ navigation }: Props) {
  const { data: imports } = useImports()
  const ids = useMemo(() => (imports ?? []).map((i) => i.id), [imports])
  const { data: summaries } = useImportSummary(ids)
  const now = useNow()

  const summaryById = useMemo(() => {
    const map = new Map<string, ImportSummary>()
    for (const s of summaries ?? []) map.set(s.importId, s)
    return map
  }, [summaries])

  if (imports && imports.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>No imports yet</Text>
        <Text style={styles.emptySub}>
          Photos and files you import appear here with their progress and results.
        </Text>
      </View>
    )
  }

  return (
    <FlatList
      style={styles.container}
      data={imports ?? []}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.listContent}
      renderItem={({ item }) => (
        <ImportListRow
          imp={item}
          summary={summaryById.get(item.id)}
          now={now}
          onPress={() => navigation.navigate('ImportDetail', { importId: item.id })}
        />
      )}
    />
  )
}

function ImportListRow({
  imp,
  summary,
  now,
  onPress,
}: {
  imp: ImportRow
  summary: ImportSummary | undefined
  now: number
  onPress: () => void
}) {
  const destinationName = useImportDestinationName(imp.directoryId)
  const importing = (summary?.status ?? 'queued') !== 'done'
  const ratio = useMonotonicRatio(importing, summary ? progressRatio(imp, summary) : 0)

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      android_ripple={{ color: palette.gray[700] }}
      style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
    >
      <View style={styles.rowHeader}>
        <Text style={styles.source} numberOfLines={1}>
          {sourceLabel(imp.source)}
        </Text>
        {importing ? (
          <View style={styles.statusBadge}>
            <SpinnerIcon color={palette.blue[400]} size={12} />
            <Text style={styles.statusImporting}>Importing</Text>
          </View>
        ) : (
          <Text style={styles.time}>{relativeTimeLabel(imp.startedAt, now)}</Text>
        )}
      </View>

      {summary ? (
        importing ? (
          <Text style={[styles.detail, styles.detailImporting]} numberOfLines={1}>
            {[progressCountLabel(imp, summary), progressBytesLabel(summary)]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        ) : imp.source === 'legacy' ? (
          // A legacy import's rows span folders and its own directoryId is null, so
          // show just the outcome counts, with no single destination.
          <Text style={styles.detail} numberOfLines={1}>
            {summaryLine(summary)}
          </Text>
        ) : (
          <View style={styles.detailRow}>
            <Text style={styles.detail} numberOfLines={1}>
              {summaryLine(summary)} ·
            </Text>
            <FolderIcon
              color={palette.gray[400]}
              size={13}
              strokeWidth={1.75}
              style={styles.detailFolder}
            />
            <Text style={[styles.detail, styles.detailDest]} numberOfLines={1}>
              {destinationName}
            </Text>
          </View>
        )
      ) : null}

      {summary && importing ? <ImportProgressBar ratio={ratio} /> : null}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgCanvas,
  },
  listContent: {
    paddingVertical: 8,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    backgroundColor: colors.bgCanvas,
  },
  emptyText: {
    color: palette.gray[100],
    fontSize: 17,
    fontWeight: '600',
  },
  emptySub: {
    color: palette.gray[400],
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
  },
  row: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 8,
    borderBottomColor: colors.borderSubtle,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowPressed: {
    backgroundColor: palette.gray[800],
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  source: {
    flexShrink: 1,
    color: palette.gray[100],
    fontSize: 16,
    fontWeight: '600',
  },
  time: {
    color: palette.gray[500],
    fontSize: 13,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  statusImporting: {
    color: palette.blue[400],
    fontSize: 13,
    fontWeight: '600',
  },
  detail: {
    color: palette.gray[400],
    fontSize: 13,
    // Drop Android's line padding so alignItems:'center' centers the folder icon on
    // the glyphs, not on the padded line box (which would sit the icon low).
    includeFontPadding: false,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  detailFolder: {
    marginHorizontal: 4,
  },
  detailDest: {
    flexShrink: 1,
  },
  detailImporting: {
    color: palette.gray[300],
    fontVariant: ['tabular-nums'],
  },
})
