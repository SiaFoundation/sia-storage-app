import type { UploadCategoryStats, UploadStats } from '@siastorage/core/db/operations'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useAccount, useStatusDisplayMode } from '@siastorage/core/stores'
import { useCallback } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import useSWR from 'swr'
import { humanSize } from '../lib/humanSize'
import type { ImportsStackParamList } from '../stacks/types'
import { app } from '../stores/appService'
import { useFileCountImporting, useFileStatsLocal, useFileStatsLost } from '../stores/files'
import { useActiveUploads } from '../stores/uploads'
import { useImportPacing } from '../stores/importPacing'
import { colors, palette, whiteA } from '../styles/colors'
import { ActivityStatusRow } from './ActivityStatusRow'
import { InsetGroupLink, InsetGroupSection, InsetGroupValueRow } from './InsetGroup'

const refreshInterval = 5_000
type Mode = 'count' | 'size'

function formatCount(count: number): string {
  return `${count.toLocaleString()} file${count === 1 ? '' : 's'}`
}

function formatSize(bytes: number | undefined): string {
  if (bytes === undefined || bytes <= 0) return '0 B'
  return humanSize(bytes) ?? '0 B'
}

/** Single-value display for non-progress rows (Library totals, Device). */
function formatModeValue(mode: Mode, count: number, bytes: number | undefined): string {
  return mode === 'count' ? formatCount(count) : formatSize(bytes)
}

/**
 * Trailing value for an upload-progress row. Completed rows collapse to a
 * single value; in-progress rows show the ratio in the current mode. The
 * ratio itself conveys progress, so no separate percent is shown.
 */
function categoryValue(mode: Mode, cat: UploadCategoryStats | undefined): string | undefined {
  if (!cat || cat.total === 0) return undefined
  const complete = cat.uploaded === cat.total
  if (mode === 'count') {
    return complete
      ? formatCount(cat.total)
      : `${cat.uploaded.toLocaleString()} / ${cat.total.toLocaleString()} files`
  }
  return complete
    ? formatSize(cat.totalBytes)
    : `${formatSize(cat.uploadedBytes)} / ${formatSize(cat.totalBytes)}`
}

function humanLimit(maxPinnedData: bigint | string | undefined): string {
  if (maxPinnedData === undefined) return '—'
  const n = Number(maxPinnedData)
  if (!Number.isFinite(n)) return '—'
  if (n >= 2 ** 62) return 'No app limit'
  return humanSize(n) ?? '—'
}

/** The status sheet's root screen; the imports flow pushes inside the same
 * sheet, so this stays mounted (and polling) beneath it. */
export function LibraryStatusSheet() {
  const navigation = useNavigation<NativeStackNavigationProp<ImportsStackParamList>>()
  const { data: rawMode = 'count' } = useStatusDisplayMode()
  const mode: Mode = rawMode === 'size' ? 'size' : 'count'
  const account = useAccount()
  const stats = useSWR(
    ['upload-stats'],
    async (): Promise<UploadStats> => {
      const indexerURL = await app().settings.getIndexerURL()
      return app().stats.uploadStats(indexerURL)
    },
    { refreshInterval },
  )
  const onDevice = useFileStatsLocal({ localOnly: false }, { refreshInterval })
  const pendingBackup = useFileStatsLocal({ localOnly: true }, { refreshInterval })
  const lost = useFileStatsLost({ refreshInterval })
  const importing = useFileCountImporting({ refreshInterval })
  const openImports = useCallback(() => {
    navigation.navigate('Imports')
  }, [navigation])
  const openUnavailable = useCallback(() => {
    navigation.navigate('Unavailable')
  }, [navigation])
  const openUploads = useCallback(() => {
    navigation.navigate('Uploads')
  }, [navigation])
  const activeUploads = useActiveUploads()
  const uploadingFileCount = activeUploads.filter((u) => u.kind !== 'thumb').length

  const importingCount = importing.data ?? 0
  const pacing = useImportPacing()
  // The cause is global (the scanner paces one queue), so the aggregate line
  // names it directly instead of resolving per-import states.
  const importsDescription =
    importingCount === 0
      ? 'Photos and files you imported.'
      : pacing?.cause === 'critical-floor'
        ? `${formatCount(importingCount)} need space to import.`
        : pacing?.cause === 'headroom'
          ? `${formatCount(importingCount)} waiting for space.`
          : pacing?.cause === 'backlog'
            ? `${formatCount(importingCount)} waiting on uploads.`
            : `${formatCount(importingCount)} importing.`

  const totalCount = stats.data?.files.total ?? 0
  const totalBytes = account.data ? Number(account.data.pinnedData) : undefined
  const availableBytes = account.data ? Number(account.data.remainingStorage) : undefined

  const categories: Array<[string, UploadCategoryStats | undefined]> = [
    ['Files', stats.data?.files],
    ['Photos', stats.data?.photos],
    ['Videos', stats.data?.videos],
    ['Audio', stats.data?.audio],
    ['Docs', stats.data?.docs],
    ['Other', stats.data?.other],
    ['Thumbnails', stats.data?.thumbnails],
  ]

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      <ActivityStatusRow />

      <View style={styles.toolbar}>
        <View style={styles.toggleTrack}>
          {(['count', 'size'] as const).map((m) => (
            <Pressable
              key={m}
              style={[styles.toggleSegment, mode === m && styles.toggleSegmentSelected]}
              onPress={() => app().settings.setStatusDisplayMode(m)}
            >
              <Text style={[styles.toggleLabel, mode === m && styles.toggleLabelSelected]}>
                {m === 'count' ? 'Count' : 'Size'}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <InsetGroupSection header="Library">
        <InsetGroupValueRow label="Total" value={formatModeValue(mode, totalCount, totalBytes)} />
        <InsetGroupValueRow
          label="Available"
          value={availableBytes !== undefined ? (humanSize(availableBytes) ?? '—') : '—'}
        />
        <InsetGroupValueRow label="Storage limit" value={humanLimit(account.data?.maxPinnedData)} />
        <InsetGroupLink
          label="Imports"
          description={importsDescription}
          onPress={openImports}
          value={importingCount > 0 ? formatCount(importingCount) : undefined}
        />
        <InsetGroupLink
          label="Uploads"
          description={
            uploadingFileCount > 0
              ? `${formatCount(uploadingFileCount)} uploading.`
              : 'Files uploading to the network.'
          }
          onPress={openUploads}
          value={uploadingFileCount > 0 ? formatCount(uploadingFileCount) : undefined}
        />
      </InsetGroupSection>

      <InsetGroupSection
        header="Upload progress"
        footer={
          mode === 'size' && importingCount > 0
            ? `Sizes do not include the ${importingCount === 1 ? 'file' : `${importingCount.toLocaleString()} files`} still pending import.`
            : 'Upload progress across all files in the library.'
        }
      >
        {categories.map(([label, cat]) => {
          const value = categoryValue(mode, cat)
          if (!value) return null
          return <InsetGroupValueRow key={label} label={label} value={value} />
        })}
      </InsetGroupSection>

      <InsetGroupSection header="Device">
        <InsetGroupValueRow
          label="On device"
          description="Files cached locally for instant access."
          value={formatModeValue(mode, onDevice.data?.count ?? 0, onDevice.data?.totalBytes)}
        />
        <InsetGroupValueRow
          label="Pending backup"
          description="On this device but not yet uploaded."
          value={formatModeValue(
            mode,
            pendingBackup.data?.count ?? 0,
            pendingBackup.data?.totalBytes,
          )}
        />
        {(lost.data?.count ?? 0) > 0 ? (
          <InsetGroupLink
            label="Unavailable"
            description="Local files that went missing before they were uploaded."
            onPress={openUnavailable}
            value={formatModeValue(mode, lost.data?.count ?? 0, lost.data?.totalBytes)}
          />
        ) : null}
      </InsetGroupSection>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgCanvas,
  },
  scrollContent: {
    paddingTop: 16,
    paddingBottom: 48,
  },
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 16,
  },
  toggleTrack: {
    flexDirection: 'row',
    backgroundColor: whiteA.a08,
    borderRadius: 8,
    padding: 2,
  },
  toggleSegment: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  toggleSegmentSelected: {
    backgroundColor: whiteA.a10,
  },
  toggleLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: palette.gray[400],
  },
  toggleLabelSelected: {
    color: palette.gray[50],
  },
})
