import { type NavigationProp, useNavigation } from '@react-navigation/native'
import type { UploadCategoryStats, UploadStats } from '@siastorage/core/db/operations'
import { useAccount, useStatusDisplayMode, useSyncState } from '@siastorage/core/stores'
import { useCallback } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import useSWR from 'swr'
import { useIsOnline } from '../hooks/useIsOnline'
import { humanSize } from '../lib/humanSize'
import { getImportBackoffEntries } from '../managers/importScanner'
import type { RootTabParamList } from '../stacks/types'
import { app } from '../stores/appService'
import { useFileStatsLocal, useFileStatsLost } from '../stores/files'
import { reconnectIndexer, useIsConnected } from '../stores/sdk'
import { closeSheet, useSheetOpen } from '../stores/sheets'
import { getActiveUploads } from '../stores/uploads'
import { palette, whiteA } from '../styles/colors'
import { InsetGroupLink, InsetGroupSection, InsetGroupValueRow } from './InsetGroup'
import { ModalSheet } from './ModalSheet'
import { StatusBanner } from './StatusBanner'

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

export function LibraryStatusSheet() {
  const isConnected = useIsConnected()
  const isOnline = useIsOnline()
  const { data: syncState } = useSyncState()
  const isSyncingDown = syncState?.isSyncingDown ?? false
  const isSyncingUpMetadata = syncState?.isSyncingUp ?? false
  const syncUpProcessed = syncState?.syncUpProcessed ?? 0
  const syncUpTotal = syncState?.syncUpTotal ?? 0
  const isOpen = useSheetOpen('libraryStatus')
  const { data: rawMode = 'count' } = useStatusDisplayMode()
  const mode: Mode = rawMode === 'size' ? 'size' : 'count'
  const account = useAccount()
  const stats = useSWR(
    ['upload-stats', isOpen ?? null],
    async (): Promise<UploadStats> => {
      const indexerURL = await app().settings.getIndexerURL()
      return app().stats.uploadStats(indexerURL)
    },
    { refreshInterval },
  )
  const onDevice = useFileStatsLocal({ localOnly: false }, { refreshInterval })
  const pendingBackup = useFileStatsLocal({ localOnly: true }, { refreshInterval })
  const lost = useFileStatsLost({ refreshInterval })
  const importErrors = useSWR(
    ['import-errors', isOpen ?? null],
    () => getImportBackoffEntries().length,
    { refreshInterval },
  )
  const navigation = useNavigation<NavigationProp<RootTabParamList>>()
  const openImportSettings = useCallback(
    (tab: 'retrying' | 'lost') => {
      closeSheet()
      navigation.navigate('MenuTab', { screen: 'Import', params: { tab }, initial: false })
    },
    [navigation],
  )
  const batch = useSWR(
    ['active-batch', isOpen ?? null],
    () => {
      const uploads = getActiveUploads()
      const count = uploads.length
      const totalBytes = uploads.reduce((s, u) => s + u.size, 0)
      return { count, totalBytes }
    },
    { refreshInterval },
  )

  const handleClose = useCallback(() => {
    closeSheet()
  }, [])

  const handleReconnect = useCallback(() => {
    void reconnectIndexer()
  }, [])

  const offline = isOnline.data === false
  const indexerDown = isOnline.data === true && !isConnected

  const importingCount = stats.data?.importingCount ?? 0
  const importErrorCount = importErrors.data ?? 0
  const activeBatchCount = batch.data?.count ?? 0

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
    <ModalSheet visible={isOpen} onRequestClose={handleClose} title="Status">
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <StatusBanner active={offline} message="No internet connection." />
        <StatusBanner
          active={indexerDown}
          message="Can't reach indexer."
          actionLabel="Reconnect"
          onAction={handleReconnect}
        />

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
          <InsetGroupValueRow
            label="Storage limit"
            value={humanLimit(account.data?.maxPinnedData)}
          />
          {importingCount > 0 ? (
            <InsetGroupValueRow label="Pending import" value={formatCount(importingCount)} />
          ) : null}
          {importErrorCount > 0 ? (
            <InsetGroupLink
              label="Import errors"
              onPress={() => openImportSettings('retrying')}
              value={formatCount(importErrorCount)}
            />
          ) : null}
        </InsetGroupSection>

        {activeBatchCount > 0 ? (
          <InsetGroupSection header="Active upload">
            <InsetGroupValueRow
              label="This batch"
              value={
                mode === 'count'
                  ? formatCount(activeBatchCount)
                  : formatSize(batch.data?.totalBytes)
              }
            />
          </InsetGroupSection>
        ) : null}

        <InsetGroupSection
          header="Upload progress"
          footer="Upload progress across all files in the library."
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
          <InsetGroupLink
            label="Unavailable"
            description="Files that were unavailable during import."
            onPress={() => openImportSettings('lost')}
            value={formatModeValue(mode, lost.data?.count ?? 0, lost.data?.totalBytes)}
          />
        </InsetGroupSection>

        <InsetGroupSection
          header="Sync metadata"
          footer="Background metadata sync with other devices."
        >
          <InsetGroupValueRow label="Remote down" value={isSyncingDown ? 'Syncing…' : 'Synced'} />
          <InsetGroupValueRow
            label="Local up"
            value={
              isSyncingUpMetadata
                ? `${syncUpProcessed.toLocaleString()} / ${syncUpTotal.toLocaleString()}`
                : 'Synced'
            }
          />
        </InsetGroupSection>
      </ScrollView>
    </ModalSheet>
  )
}

const styles = StyleSheet.create({
  scrollContent: {
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
