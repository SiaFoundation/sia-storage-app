import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import type { ImportFileRow, ImportRow, ImportSummary } from '@siastorage/core/db/operations'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, FlatList, StyleSheet, Text, TextInput, View } from 'react-native'
import { ImportCountChips } from '../components/ImportCountChips'
import { ImportFileStateBadge } from '../components/ImportFileStateBadge'
import { ImportProgressBar } from '../components/ImportProgressBar'
import { SpinnerIcon } from '../components/SpinnerIcon'
import { InsetGroupLink, InsetGroupSection, InsetGroupValueRow } from '../components/InsetGroup'
import { useMonotonicRatio } from '../hooks/useMonotonicRatio'
import { useNow } from '../hooks/useNow'
import {
  isRetryingRow,
  progressBytesLabel,
  progressCountLabel,
  progressRatio,
  reasonCopy,
  retryCountdownLabel,
  detailStatusLabel,
  sourceLabel,
  statusColor,
} from '../lib/importLabels'
import { relativeTimeLabel } from '../lib/relativeTime'
import { deleteImportWithCleanup } from '../lib/importDelete'
import { triggerImportScanner } from '../managers/importScanner'
import { app } from '../stores/appService'
import type { ImportsStackParamList } from '../stacks/types'
import {
  parsePendingTags,
  useImport,
  useImportDestinationName,
  useImportFiles,
  useImportSummary,
} from '../stores/imports'
import { colors, palette } from '../styles/colors'

type Props = NativeStackScreenProps<ImportsStackParamList, 'ImportDetail'>

// Initial page of import_files rows. A large library-scan (50k+ children) is
// counts-only by default: the summary header carries the full picture and only
// this capped, paginated window of rows is ever rendered. `onEndReached` grows
// the window by PAGE_SIZE.
const PAGE_SIZE = 100

// Below this many rows a search field is clutter; everything is on screen.
const SEARCH_THRESHOLD = 20

const SEARCH_DEBOUNCE_MS = 250

export function ImportDetailScreen({ route, navigation }: Props) {
  // Remount per import: navigating to another import's detail while this
  // screen is focused updates params in place, and search, pagination, and
  // the bar's high-water mark must not carry over.
  return (
    <ImportDetailContent
      key={route.params.importId}
      importId={route.params.importId}
      navigation={navigation}
    />
  )
}

function ImportDetailContent({
  importId,
  navigation,
}: {
  importId: string
  navigation: Props['navigation']
}) {
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [searchInput])

  const { data: imp } = useImport(importId)
  const { data: summaries } = useImportSummary([importId])
  const { data: files } = useImportFiles(importId, {
    limit,
    search: search || undefined,
  })
  const destinationName = useImportDestinationName(imp?.directoryId)

  const summary = summaries?.[0]
  const tags = useMemo(() => parsePendingTags(imp?.pendingTags), [imp?.pendingTags])
  const now = useNow()
  // Backoff rows in the loaded window; "Retry now" clears their nextAttemptAt.
  // Rows beyond the pagination window keep their schedule (they retry anyway).
  const retryingIds = useMemo(
    () => (files ?? []).filter((f) => isRetryingRow(f, now)).map((f) => f.id),
    [files, now],
  )

  const handleLoadMore = useCallback(() => {
    // Only grow when the current window is full; otherwise we already have
    // every row.
    if (files && files.length >= limit) setLimit((n) => n + PAGE_SIZE)
  }, [files, limit])

  const handleCancel = useCallback(() => {
    Alert.alert(
      'Cancel import',
      'Stop importing the remaining files? Files already added stay in your library.',
      [
        { text: 'Keep importing', style: 'cancel' },
        {
          text: 'Cancel import',
          style: 'destructive',
          onPress: async () => {
            // Cancel the in-flight children in one UPDATE (no
            // unbounded read of a 50k import's rows); already-added files are
            // real files and are left alone.
            await app().imports.cancelImport(importId)
            app().caches.imports.invalidateAll()
          },
        },
      ],
    )
  }, [importId])

  const handleRetryNow = useCallback(async () => {
    // Clear the backoff timers so the scanner reclaims these rows on its next
    // tick; `attempts` is kept so the Retrying label stays honest.
    await app().imports.retry(retryingIds)
    app().caches.imports.invalidateAll()
    triggerImportScanner()
  }, [retryingIds])

  const handleRetry = useCallback(async () => {
    // Return this import's terminal failures (failed + unavailable) to pending.
    // The global `retry()` would not work here: it only re-arms `pending` rows
    // with attempts>0, a disjoint set that never touches terminal rows.
    await app().imports.retryFailed(importId)
    app().caches.imports.invalidateAll()
    triggerImportScanner()
  }, [importId])

  const handleRemove = useCallback(() => {
    Alert.alert(
      'Remove from history',
      'This clears the import record and its file list. Files added to your library are not affected.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            await deleteImportWithCleanup(importId)
            navigation.goBack()
          },
        },
      ],
    )
  }, [importId, navigation])

  const showSearch = (summary?.total ?? 0) > SEARCH_THRESHOLD || search.length > 0
  const header = (
    <ImportDetailHeader
      imp={imp}
      summary={summary}
      destinationName={destinationName}
      tags={tags}
      now={now}
      searchInput={showSearch ? searchInput : null}
      onSearchInput={setSearchInput}
      onCancel={handleCancel}
      onRetry={handleRetry}
      onRetryNow={retryingIds.length > 0 ? handleRetryNow : null}
      onRemove={handleRemove}
    />
  )

  const rows = files ?? []
  return (
    <FlatList
      style={styles.container}
      data={rows}
      keyExtractor={(item) => item.id}
      ListHeaderComponent={header}
      contentContainerStyle={styles.listContent}
      onEndReached={handleLoadMore}
      onEndReachedThreshold={0.5}
      windowSize={8}
      removeClippedSubviews
      renderItem={({ item, index }) => (
        <ImportFileListRow
          file={item}
          now={now}
          first={index === 0}
          last={index === rows.length - 1}
        />
      )}
      ItemSeparatorComponent={FileRowDivider}
      ListEmptyComponent={
        files ? (
          <Text style={styles.emptyFiles}>
            {search ? 'No files match your search.' : 'No files in this import.'}
          </Text>
        ) : null
      }
    />
  )
}

function ImportDetailHeader({
  imp,
  summary,
  destinationName,
  tags,
  now,
  searchInput,
  onSearchInput,
  onCancel,
  onRetry,
  onRetryNow,
  onRemove,
}: {
  imp: ImportRow | null | undefined
  summary: ImportSummary | undefined
  destinationName: string
  tags: string[]
  now: number
  searchInput: string | null
  onSearchInput: (text: string) => void
  onCancel: () => void
  onRetry: () => void
  onRetryNow: (() => void) | null
  onRemove: () => void
}) {
  const status = summary?.status ?? 'queued'
  const importing = status !== 'done'
  // Terminal failures the user can re-attempt: `failed` (processing error) and
  // `unavailable` (source was unretrievable). retryFailed returns both to pending.
  const hasRetryable = (summary?.failed ?? 0) + (summary?.unavailable ?? 0) > 0
  const ratio = useMonotonicRatio(importing, imp && summary ? progressRatio(imp, summary) : 0)
  const bytesLabel = summary ? progressBytesLabel(summary) : null

  return (
    <View style={styles.header}>
      <InsetGroupSection header="Import">
        <InsetGroupValueRow label="Source" value={imp ? sourceLabel(imp.source) : '—'} />
        {imp?.source === 'legacy' ? null : (
          // A legacy import's rows span folders and its own directoryId is null, so it
          // has no single destination to show.
          <InsetGroupValueRow label="Destination" value={destinationName} />
        )}
        {tags.length > 0 ? <InsetGroupValueRow label="Tags" value={tags.join(', ')} /> : null}
        {imp ? (
          <InsetGroupValueRow label="Started" value={relativeTimeLabel(imp.startedAt, now)} />
        ) : null}
        <InsetGroupValueRow
          label="Status"
          valueSlot={
            summary ? (
              <View style={styles.statusBadge}>
                {importing ? <SpinnerIcon color={palette.blue[400]} size={12} /> : null}
                <Text style={[styles.statusText, { color: statusColor(summary) }]}>
                  {detailStatusLabel(summary)}
                </Text>
              </View>
            ) : (
              <Text style={styles.statusText}>—</Text>
            )
          }
        />
      </InsetGroupSection>

      {imp && summary && importing ? (
        <View style={styles.progressBlock}>
          <ImportProgressBar ratio={ratio} />
          <Text style={styles.progressLabel}>
            {progressCountLabel(imp, summary)}
            {bytesLabel ? `  ·  ${bytesLabel}` : ''}
          </Text>
        </View>
      ) : null}

      {summary ? (
        <View style={styles.chipsBlock}>
          <ImportCountChips summary={summary} />
        </View>
      ) : null}

      <InsetGroupSection>
        {importing ? (
          <InsetGroupLink
            label="Cancel import"
            destructive
            showChevron={false}
            onPress={onCancel}
          />
        ) : null}
        {onRetryNow ? (
          <InsetGroupLink label="Retry now" showChevron={false} onPress={onRetryNow} />
        ) : null}
        {hasRetryable ? (
          <InsetGroupLink label="Retry failed" showChevron={false} onPress={onRetry} />
        ) : null}
        <InsetGroupLink
          label="Remove from history"
          description="Files in your library are kept"
          destructive
          showChevron={false}
          onPress={onRemove}
        />
      </InsetGroupSection>

      <Text style={styles.filesHeader}>FILES</Text>
      {searchInput !== null ? (
        <View style={styles.searchWrap}>
          <TextInput
            style={styles.searchInput}
            value={searchInput}
            onChangeText={onSearchInput}
            placeholder="Search files"
            placeholderTextColor={palette.gray[500]}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            accessibilityLabel="Search files"
          />
        </View>
      ) : null}
    </View>
  )
}

function FileRowDivider() {
  // The hairline must sit on a panel-colored strip; a bare separator between
  // the card's segments would punch a canvas-colored gap through the card.
  return (
    <View style={styles.fileDividerWrap}>
      <View style={styles.fileDividerPanel}>
        <View style={styles.fileDivider} />
      </View>
    </View>
  )
}

function ImportFileListRow({
  file,
  now,
  first,
  last,
}: {
  file: ImportFileRow
  now: number
  first: boolean
  last: boolean
}) {
  const copy = reasonCopy(file.reason)
  const showReason = copy && file.state !== 'added'
  const retrying = isRetryingRow(file, now)
  return (
    <View style={styles.fileRowWrap}>
      <View
        style={[
          styles.fileRow,
          first ? styles.fileRowFirst : null,
          last ? styles.fileRowLast : null,
        ]}
      >
        <View style={styles.fileText}>
          <Text style={styles.fileName} numberOfLines={1}>
            {file.name}
          </Text>
          {showReason ? (
            <Text style={styles.fileReason} numberOfLines={1}>
              {retrying ? `${copy} · next ${retryCountdownLabel(file.nextAttemptAt, now)}` : copy}
            </Text>
          ) : null}
        </View>
        <ImportFileStateBadge row={file} now={now} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgCanvas,
  },
  listContent: {
    paddingBottom: 64,
  },
  header: {
    paddingTop: 16,
  },
  progressBlock: {
    paddingHorizontal: 32,
    marginBottom: 16,
    gap: 8,
  },
  progressLabel: {
    color: palette.gray[400],
    fontSize: 13,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  chipsBlock: {
    paddingHorizontal: 16,
    marginBottom: 28,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  statusText: {
    fontSize: 15,
    fontWeight: '600',
    color: palette.gray[400],
  },
  filesHeader: {
    color: palette.gray[400],
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: 0.4,
    paddingHorizontal: 32,
    paddingBottom: 6,
  },
  searchWrap: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  searchInput: {
    backgroundColor: colors.bgPanel,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
    color: palette.gray[100],
    fontSize: 15,
  },
  fileRowWrap: {
    paddingHorizontal: 16,
  },
  fileDividerWrap: {
    paddingHorizontal: 16,
  },
  fileDividerPanel: {
    backgroundColor: colors.bgPanel,
  },
  fileDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.borderSubtle,
    marginLeft: 16,
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: colors.bgPanel,
  },
  fileRowFirst: {
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
  },
  fileRowLast: {
    borderBottomLeftRadius: 10,
    borderBottomRightRadius: 10,
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
  emptyFiles: {
    color: palette.gray[400],
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: 24,
  },
})
